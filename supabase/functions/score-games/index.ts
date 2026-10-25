// score-games: locks overdue games and scores finals (plan U5).
//
// Called by pg_cron every 2 minutes (see migration 20261025130500) with the
// shared secret in `x-internal-secret`. The rules live in the database:
//   1. scorer_lock_games()         open -> locked once lock_at has passed,
//                                  and snapshots the fan split.
//   2. scorer_pending_games(days)  finals, recently scored games (a changed
//                                  score re-scores; an unchanged one is a
//                                  no-op) and void games with live picks.
//   3. scorer_score_game(id) / scorer_void_game(id), one game per call so a
//                                  failure in one game never half-scores
//                                  another. Errors are collected, logged to
//                                  alert_log, and the run continues.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { sendAdminAlert } from "../_shared/alerts/index.ts";

const LOOKBACK_DAYS = 3;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function recordAlert(db: SupabaseClient, message: string, details: Record<string, unknown>) {
  const { error } = await db.from("alert_log").insert({ kind: "scorer_failure", message, details });
  if (error) console.error("score-games: could not record alert", error.message);
}

interface PendingGame {
  game_id: number;
  app_state: string;
}

interface RunSummary {
  locked: number;
  examined: number;
  scored: number;
  unchanged: number;
  voided: number;
  failed: { gameId: number; error: string }[];
}

async function run(db: SupabaseClient): Promise<RunSummary> {
  const summary: RunSummary = { locked: 0, examined: 0, scored: 0, unchanged: 0, voided: 0, failed: [] };

  const lock = await db.rpc("scorer_lock_games");
  if (lock.error) throw new Error(`lock_games: ${lock.error.message}`);
  summary.locked = typeof lock.data === "number" ? lock.data : 0;

  const pending = await db.rpc("scorer_pending_games", { p_days: LOOKBACK_DAYS });
  if (pending.error) throw new Error(`pending_games: ${pending.error.message}`);
  const games = (pending.data ?? []) as PendingGame[];

  for (const game of games) {
    summary.examined += 1;
    try {
      if (game.app_state === "void") {
        const { data, error } = await db.rpc("scorer_void_game", { p_game_id: game.game_id });
        if (error) throw new Error(error.message);
        if (typeof data === "number" && data > 0) summary.voided += 1;
        continue;
      }
      const { data, error } = await db.rpc("scorer_score_game", { p_game_id: game.game_id });
      if (error) throw new Error(error.message);
      if (data === true) summary.scored += 1;
      else summary.unchanged += 1;
    } catch (err) {
      // One bad game must not stop the rest. score_game is one transaction
      // per call, so this game is left exactly as it was.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`score-games: game ${game.game_id} failed`, message);
      summary.failed.push({ gameId: game.game_id, error: message });
    }
  }

  // Leaderboards (U6) are materialized views refreshed once per run, after
  // every game has been scored, not once per game.
  if (summary.scored > 0 || summary.voided > 0) {
    const refresh = await db.rpc("scorer_refresh_leaderboards");
    if (refresh.error) {
      console.error("score-games: leaderboard refresh failed", refresh.error.message);
      summary.failed.push({ gameId: 0, error: `refresh_leaderboards: ${refresh.error.message}` });
    }
  }

  return summary;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return json(401, { error: "unauthorized" });
  }

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("score-games: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  try {
    const summary = await run(db);
    if (summary.failed.length > 0) {
      const message = `score-games could not score ${summary.failed.length} game(s)`;
      const details = { failed: summary.failed };
      await sendAdminAlert("scorer_failure", message, details);
      await recordAlert(db, message, details);
    }
    return json(200, { ok: summary.failed.length === 0, ...summary });
  } catch (err) {
    // The sweep itself failed before any game was touched.
    const message = err instanceof Error ? err.message : String(err);
    console.error("score-games: run failed", message);
    const details = { error: message };
    await sendAdminAlert("scorer_failure", `score-games run failed: ${message}`, details);
    await recordAlert(db, `score-games run failed: ${message}`, details);
    return json(502, { ok: false, error: message });
  }
});
