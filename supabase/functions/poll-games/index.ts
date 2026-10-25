// poll-games: the only thing that talks to MLB (plan U4).
//
// Called by pg_cron (see migration 20261025130400_u4_poller.sql) with the
// shared secret in `x-internal-secret`. Fetches today's and tomorrow's
// schedule (MLB's day = America/New_York), upserts every game into
// public.games with a recomputed app_state and lock_at, stores highlight
// links on final games, and keeps a consecutive-failure counter that alerts
// the admin after three failed polls in a row.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  POLLER_FAILURE_KEY,
  parseFailureCounter,
  recordFailure,
  recordSuccess,
  sendAdminAlert,
} from "../_shared/alerts/index.ts";
import { addDays, dedupeSchedule, localDate } from "../_shared/domain/game-state.ts";
import { type ExistingGameRow, planGameUpdate } from "../_shared/domain/poll-plan.ts";
import { createMlbProvider } from "../_shared/providers/mlb/client.ts";
import { mapSchedule, mapScheduleHighlights } from "../_shared/providers/mlb/map.ts";

const PROVIDER = "mlb";

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

async function loadTeamIds(db: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await db.from("teams").select("id, abbreviation");
  if (error) throw new Error(`teams: ${error.message}`);
  return new Map((data ?? []).map((t: { id: number; abbreviation: string }) => [t.abbreviation, t.id]));
}

async function loadExisting(db: SupabaseClient, ids: string[]): Promise<Map<string, ExistingGameRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from("games")
    .select("provider_game_id, app_state, lock_at, highlights")
    .eq("provider", PROVIDER)
    .in("provider_game_id", ids);
  if (error) throw new Error(`games: ${error.message}`);
  return new Map(
    (data ?? []).map((g: ExistingGameRow & { provider_game_id: string }) => [
      g.provider_game_id,
      { app_state: g.app_state, lock_at: g.lock_at, highlights: g.highlights },
    ]),
  );
}

async function readCounter(db: SupabaseClient) {
  const { data } = await db.from("app_settings").select("value").eq("key", POLLER_FAILURE_KEY).maybeSingle();
  return parseFailureCounter(data?.value);
}

async function writeCounter(db: SupabaseClient, value: unknown) {
  const { error } = await db
    .from("app_settings")
    .upsert({ key: POLLER_FAILURE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("poll-games: could not write failure counter", error.message);
}

async function recordAlert(db: SupabaseClient, kind: string, message: string, details: unknown) {
  const { error } = await db.from("alert_log").insert({ kind, message, details });
  if (error) console.error("poll-games: could not record alert", error.message);
}

interface PollSummary {
  dates: [string, string];
  fetched: number;
  upserted: number;
  skipped: number;
  failed: number;
  reopened: string[];
  transitions: Record<string, number>;
}

async function poll(db: SupabaseClient, now: Date): Promise<PollSummary> {
  const today = localDate(now, "America/New_York");
  const tomorrow = addDays(today, 1);

  const provider = createMlbProvider({ fetch: (url, init) => fetch(url, init) });
  const raw = await provider.rawSchedule(today, tomorrow);
  const games = dedupeSchedule(mapSchedule(raw));
  const highlightsById = mapScheduleHighlights(raw);

  const teamIds = await loadTeamIds(db);
  const existing = await loadExisting(
    db,
    games.map((g) => g.providerGameId),
  );

  const summary: PollSummary = {
    dates: [today, tomorrow],
    fetched: games.length,
    upserted: 0,
    skipped: 0,
    failed: 0,
    reopened: [],
    transitions: {},
  };

  for (const game of games) {
    try {
      const plan = planGameUpdate({
        provider: PROVIDER,
        game,
        existing: existing.get(game.providerGameId) ?? null,
        teamIds,
        highlights: highlightsById.get(game.providerGameId),
        now,
      });
      if (plan.kind === "skip") {
        summary.skipped += 1;
        console.warn(`poll-games: skip ${game.providerGameId}: ${plan.reason}`);
        continue;
      }
      const { error } = await db
        .from("games")
        .upsert(plan.row, { onConflict: "provider,provider_game_id" });
      if (error) throw new Error(error.message);

      summary.upserted += 1;
      if (plan.prevState !== plan.row.app_state) {
        const key = `${plan.prevState ?? "new"}->${plan.row.app_state}`;
        summary.transitions[key] = (summary.transitions[key] ?? 0) + 1;
      }
      if (plan.reopened) summary.reopened.push(game.providerGameId);
    } catch (err) {
      // One bad game must not abort the batch.
      summary.failed += 1;
      console.error(`poll-games: game ${game.providerGameId} failed`, err);
    }
  }

  return summary;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return json(401, { error: "unauthorized" });
  }

  const now = new Date();
  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("poll-games: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  try {
    const summary = await poll(db, now);
    const prev = await readCounter(db);
    if (prev.count > 0) {
      console.log(`poll-games: recovered after ${prev.count} failure(s)`);
    }
    await writeCounter(db, recordSuccess(prev));
    return json(200, { ok: true, ...summary });
  } catch (err) {
    // Fetch or mapping failed: existing rows are untouched. Count it.
    const message = err instanceof Error ? err.message : String(err);
    console.error("poll-games: poll failed", message);
    const prev = await readCounter(db);
    const { counter, alert } = recordFailure(prev, message, now);
    await writeCounter(db, counter);
    if (alert) {
      const details = { consecutiveFailures: counter.count, lastError: message };
      await sendAdminAlert("poller_failure", `poll-games has failed ${counter.count} times in a row`, details);
      await recordAlert(db, "poller_failure", `poll-games has failed ${counter.count} times in a row`, details);
    }
    return json(502, { ok: false, error: message, consecutiveFailures: counter.count });
  }
});
