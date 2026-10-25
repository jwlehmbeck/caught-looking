import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { FanSplit } from "@/components/fan-split";
import { GameHeader } from "@/components/game-header";
import { HighlightLinks } from "@/components/highlight-links";
import { GAME_SELECT, PickCardServer, type GameRow } from "@/components/pick-card/pick-card-server";
import { ResultCard } from "@/components/result-card";
import { SanctionBanner } from "@/components/sanction-banner";
import { TopPredictors, type TopPredictorRow } from "@/components/top-predictors";
import { buildGameView, type ViewBadge, type ViewGame, type ViewHighlight, type ViewPick } from "@/lib/game/view-state";
import type { PickSplit } from "@/lib/picks/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SELECT = `${GAME_SELECT}, detailed_state, season, highlights`;

interface PageGameRow extends GameRow {
  detailed_state: string | null;
  season: number;
  highlights: unknown;
}

const card: React.CSSProperties = {
  background: "var(--cl-bg-raised)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: 16,
  display: "grid",
  gap: 8,
};

function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Keeps only well-formed highlight entries from the poller's jsonb. */
function parseHighlights(raw: unknown): ViewHighlight[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewHighlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { title, url, durationSeconds } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string") continue;
    out.push(
      typeof durationSeconds === "number" ? { title, url, durationSeconds } : { title, url },
    );
  }
  return out;
}

function toViewGame(row: PageGameRow): ViewGame | null {
  if (!row.home || !row.away) return null;
  return {
    id: row.id,
    appState: row.app_state,
    lockAt: row.lock_at,
    gameDate: row.game_date,
    detailedState: row.detailed_state,
    home: { id: row.home.id, abbreviation: row.home.abbreviation, name: row.home.name },
    away: { id: row.away.id, abbreviation: row.away.abbreviation, name: row.away.name },
    homeScore: row.home_score,
    awayScore: row.away_score,
    winnerTeamId: row.winner_team_id,
    countsForPicks: row.counts_for_picks,
    highlights: parseHighlights(row.highlights),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const gameId = parseId(id);
  if (gameId === null) return { title: "Game" };
  const supabase = await createClient();
  const { data } = await supabase.from("games").select(GAME_SELECT).eq("id", gameId).maybeSingle();
  const row = data as unknown as GameRow | null;
  if (!row?.home || !row.away) return { title: "Game" };
  return { title: `${row.away.abbreviation} at ${row.home.abbreviation}` };
}

/**
 * One page per game: before (pick card, then split and top predictors once
 * the viewer has picked), during (score, locked pick, chat slot), after
 * (result card, hit rate, badges, highlight links), plus plain void and
 * suspended notices. U9 fills the chat slot; U10/U11 fill "Fan edits".
 */
export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = parseId(id);
  if (gameId === null) notFound();

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const { data } = await supabase.from("games").select(PAGE_SELECT).eq("id", gameId).maybeSingle();
  const row = (data as unknown as PageGameRow | null) ?? null;
  if (!row) notFound();
  const game = toViewGame(row);
  if (!game) notFound();

  const [pickRes, statsRes, badgesRes] = await Promise.all([
    supabase.from("picks").select("team_id, status").eq("game_id", game.id).eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_stats")
      .select("picks_scored, picks_correct")
      .eq("user_id", userId)
      .eq("season", row.season)
      .maybeSingle(),
    supabase
      .from("user_badges")
      .select("badge_slug, times_earned, badge:badges (name, description, sort_order)")
      .eq("user_id", userId)
      .eq("last_game_id", game.id),
  ]);

  const pickRow = pickRes.data as { team_id: number; status: ViewPick["status"] } | null;
  const pick: ViewPick | null = pickRow ? { teamId: pickRow.team_id, status: pickRow.status } : null;
  const stats = (statsRes.data as { picks_scored: number; picks_correct: number } | null) ?? null;

  type BadgeJoin = {
    badge_slug: string;
    times_earned: number;
    badge: { name: string; description: string; sort_order: number } | null;
  };
  const badges: ViewBadge[] = ((badgesRes.data ?? []) as unknown as BadgeJoin[])
    .filter((b) => b.badge)
    .sort((a, b) => (a.badge?.sort_order ?? 0) - (b.badge?.sort_order ?? 0))
    .map((b) => ({
      slug: b.badge_slug,
      name: b.badge!.name,
      description: b.badge!.description,
      timesEarned: b.times_earned,
    }));

  const view = buildGameView({ game, pick, stats, badges });

  // Split and top predictors: the RPCs return nothing until the viewer has
  // picked or the game has locked, so the page only asks when the view says so.
  let split: PickSplit | null = null;
  let predictors: TopPredictorRow[] = [];
  if (view.showSplitAndPredictors) {
    const [splitRes, topRes] = await Promise.all([
      supabase.rpc("pick_split", { p_game_id: game.id }),
      supabase.rpc("game_top_predictors", { p_game_id: game.id, p_limit: 3 }),
    ]);
    const splitRows = (splitRes.data ?? []) as { home_count: number; away_count: number; total: number }[];
    if (splitRows[0]) {
      split = { home: splitRows[0].home_count, away: splitRows[0].away_count, total: splitRows[0].total };
    }
    predictors = ((topRes.data ?? []) as TopPredictorRow[]).slice(0, 3);
  }

  // The pick card carries its own split bar, so the standalone one only
  // appears where the pick card is not rendered.
  const renderPickCard = view.phase === "open" || view.phase === "locked" || view.phase === "live" || view.phase === "suspended";
  const colors = { away: row.away?.color_primary, home: row.home?.color_primary };

  return (
    <main className="cl-shell" style={{ paddingTop: 24, paddingBottom: 48, display: "grid", gap: 16 }}>
      <GameHeader
        away={game.away}
        home={game.home}
        gameDate={game.gameDate}
        center={view.header}
        statusLine={view.phase === "open" ? view.statusLine : null}
        colors={colors}
      />

      <SanctionBanner />

      {view.voidText ? (
        <section role="status" aria-label="Game status" style={card}>
          <h2 style={{ fontSize: 22, textTransform: "uppercase" }}>
            {view.header.bottom === "Postponed" ? "Postponed" : view.header.bottom === "Cancelled" ? "Cancelled" : "No result"}
          </h2>
          <p style={{ fontSize: 15, color: "var(--cl-text-muted)" }}>{view.voidText}</p>
          {view.pickLine ? (
            <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Your pick was cleared. Pick again if it&apos;s rescheduled.</p>
          ) : null}
        </section>
      ) : null}

      {view.suspendedText ? (
        <section role="status" aria-label="Game status" style={card}>
          <h2 style={{ fontSize: 22, textTransform: "uppercase" }}>Suspended</h2>
          <p style={{ fontSize: 15, color: "var(--cl-text-muted)" }}>{view.suspendedText}</p>
        </section>
      ) : null}

      {(view.phase === "locked" || view.phase === "live") && view.statusLine ? (
        <p role="status" style={{ textAlign: "center", fontSize: 14, color: "var(--cl-text-muted)" }}>
          {view.phase === "locked" ? "Picks are locked" : `Picks are locked · ${view.statusLine}`}
        </p>
      ) : null}

      {renderPickCard ? <PickCardServer game={row} /> : null}

      {view.showResult && view.result ? (
        <ResultCard result={view.result} hitRateLine={view.hitRateLine} badges={view.badges} />
      ) : null}

      {view.showResult && split ? (
        <FanSplit away={game.away} home={game.home} split={split} caption="at first pitch" />
      ) : null}

      {view.showSplitAndPredictors ? <TopPredictors game={game} rows={predictors} /> : null}

      {view.showChatSlot ? (
        // TODO(U9): replace this placeholder with the live chat section.
        <section id="chat" aria-labelledby="chat-heading" style={card}>
          <h2 id="chat-heading" style={{ fontSize: 22, textTransform: "uppercase" }}>
            Live chat
          </h2>
          <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Live chat arrives here.</p>
        </section>
      ) : null}

      {view.showHighlights ? <HighlightLinks highlights={game.highlights} /> : null}

      {view.showFanEditsPlaceholder ? (
        // TODO(U10/U11): fan edits and clips from this game.
        <section aria-labelledby="fan-edits-heading" style={card}>
          <h2 id="fan-edits-heading" style={{ fontSize: 22, textTransform: "uppercase" }}>
            Fan edits from this game
          </h2>
          <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Fan edits arrive here once uploads open.</p>
        </section>
      ) : null}

      <footer style={{ fontSize: 12, color: "var(--cl-text-muted)", textAlign: "center", paddingTop: 8 }}>
        Not affiliated with MLB or any club.
      </footer>
    </main>
  );
}
