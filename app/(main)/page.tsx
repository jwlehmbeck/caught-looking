import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveChatPreview, NextGamePreview, type ChatPreviewMessage } from "@/components/chat-preview/chat-preview";
import { FeedList } from "@/components/feed/feed-list";
import { FeedTabs } from "@/components/feed/feed-tabs";
import { GamesStrip } from "@/components/games-strip/games-strip";
import { HitRateChip } from "@/components/hit-rate-chip";
import { GAME_SELECT, PickCardServer, type GameRow } from "@/components/pick-card/pick-card-server";
import { PollList } from "@/components/poll-list";
import { SanctionBanner } from "@/components/sanction-banner";
import { loadFeed } from "@/lib/feed/actions";
import { buildHomeState, type HomeGame } from "@/lib/home/home-state";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@shared/domain/game-state.ts";
import { isFeedTab, type FeedTab } from "@shared/domain/hot-score.ts";

export const dynamic = "force-dynamic";

interface HomeGameRow extends GameRow {
  detailed_state: string | null;
}

const EMPTY: Record<FeedTab, string> = {
  hot: "Nothing here yet. Share an MLB.com or YouTube clip to get it going.",
  new: "Nothing here yet. Share an MLB.com or YouTube clip to get it going.",
  my_team: "No posts tagged with your team yet.",
};

const card: React.CSSProperties = {
  background: "var(--cl-bg-raised)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: "14px 16px",
  display: "grid",
  gap: 4,
};

function toHomeGame(row: HomeGameRow): HomeGame | null {
  if (!row.home || !row.away) return null;
  return {
    id: row.id,
    appState: row.app_state,
    lockAt: row.lock_at,
    gameDate: row.game_date,
    detailedState: row.detailed_state,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeAbbr: row.home.abbreviation,
    awayAbbr: row.away.abbreviation,
    homeScore: row.home_score,
    awayScore: row.away_score,
  };
}

function initials(username: string | null): string {
  return (username ?? "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
}

/**
 * The home screen (prototype "Home, version B"): header, today's games,
 * the next pick, a live chat preview, rivalry polls, then the feed with
 * Hot / New / My Team and "Load more". Off days (no games) drop the game
 * sections and let the feed, news included, carry the page.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/signup");

  const params = await searchParams;
  const tab: FeedTab = isFeedTab(params.tab) ? params.tab : "hot";
  const now = new Date();
  const today = localDate(now, "America/New_York");

  const [gamesRes, profileRes, roleRes, seasonRes] = await Promise.all([
    supabase
      .from("games")
      .select(`${GAME_SELECT}, detailed_state`)
      .eq("official_date", today)
      .order("game_date", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("profiles").select("username, favorite_team_id").eq("id", userId).maybeSingle(),
    supabase.rpc("my_role"),
    supabase.rpc("current_season"),
  ]);

  const rows = ((gamesRes.data ?? []) as unknown as HomeGameRow[]).filter((r) => r.home && r.away);
  const games = rows.map(toHomeGame).filter((g): g is HomeGame => g !== null);
  const profile = profileRes.data as { username: string | null; favorite_team_id: number | null } | null;
  const favoriteTeamId = profile?.favorite_team_id ?? null;
  const isStaff = roleRes.data === "mod" || roleRes.data === "admin";
  const season = typeof seasonRes.data === "number" ? seasonRes.data : now.getFullYear();
  const gameIds = games.map((g) => g.id);

  // Viewer's picks for today, their season stats, and chat activity for the
  // live games (only needed when there's more than one to choose from).
  const liveIds = games.filter((g) => g.appState === "live" || g.appState === "locked").map((g) => g.id);
  const [picksRes, statsRes, activityRes, feedPage] = await Promise.all([
    gameIds.length > 0
      ? supabase.from("picks").select("game_id").eq("user_id", userId).in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: number }[] }),
    supabase.from("user_stats").select("picks_scored, picks_correct").eq("user_id", userId).eq("season", season).maybeSingle(),
    liveIds.length > 1
      ? supabase.rpc("home_chat_activity", { p_game_ids: liveIds })
      : Promise.resolve({ data: [] as { game_id: number; last_message_at: string }[] }),
    loadFeed(tab, 0),
  ]);

  const pickedGameIds = new Set(((picksRes.data ?? []) as { game_id: number }[]).map((p) => p.game_id));
  const stats = (statsRes.data as { picks_scored: number; picks_correct: number } | null) ?? { picks_scored: 0, picks_correct: 0 };
  const lastChatAt: Record<number, string> = {};
  for (const r of (activityRes.data ?? []) as { game_id: number; last_message_at: string }[]) lastChatAt[r.game_id] = r.last_message_at;

  const home = buildHomeState({ games, pickedGameIds, favoriteTeamId, lastChatAt, now });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const matchupOf = (id: number) => {
    const r = rowById.get(id);
    return r?.home && r.away ? `${r.away.abbreviation} @ ${r.home.abbreviation}` : "";
  };

  let chatMessages: ChatPreviewMessage[] = [];
  if (home.chat?.kind === "live") {
    const { data } = await supabase.rpc("chat_history", { p_game_id: home.chat.gameId, p_limit: 2 });
    chatMessages = ((data ?? []) as { id: number; username: string | null; body: string }[]).map((m) => ({
      id: m.id,
      username: m.username,
      body: m.body,
    }));
  }

  // My Team falls back to league-wide when the team tab is empty.
  let feedTab: FeedTab = tab;
  let feed = feedPage;
  let fallbackNote: string | null = null;
  if (tab === "my_team" && feed.posts.length === 0) {
    feedTab = "hot";
    feed = await loadFeed("hot", 0);
    fallbackNote = favoriteTeamId
      ? "Nothing tagged with your team yet. Here's what's hot across the league."
      : "Pick a favorite team in Settings to fill this tab. For now, here's what's hot across the league.";
  }

  return (
    <main className="cl-shell" style={{ paddingTop: 24, paddingBottom: 24, display: "grid", gap: 14 }}>
      <SanctionBanner />

      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h1 style={{ fontSize: 28, letterSpacing: 1, lineHeight: 1, flex: "1 0 auto" }}>
          CAUGHT <span style={{ color: "var(--cl-accent)" }}>LOOKING</span>
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {isStaff ? (
            <Link
              href="/mod"
              style={{
                minHeight: "var(--cl-tap)",
                minWidth: "var(--cl-tap)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Mod
            </Link>
          ) : null}
          <Link href="/profile" style={{ color: "inherit", borderRadius: "var(--cl-radius-pill)" }}>
            <HitRateChip stats={stats} />
          </Link>
          <Link
            href="/profile"
            aria-label="Your profile"
            style={{
              width: 44,
              height: 44,
              flex: "0 0 auto",
              borderRadius: 22,
              border: "2px solid var(--cl-accent)",
              background: "var(--cl-bg-card)",
              color: "var(--cl-text)",
              fontWeight: 700,
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {initials(profile?.username ?? null)}
          </Link>
        </div>
      </header>

      {home.noGames ? (
        <p role="status" style={{ ...card, color: "var(--cl-text-muted)", fontSize: 15 }}>
          No games today. Catch up on the news below.
        </p>
      ) : (
        <>
          <GamesStrip items={home.strip} />

          {home.pickCard?.kind === "game" ? (
            <PickCardServer game={rowById.get(home.pickCard.gameId)} openTitle="Make your pick" emphasis />
          ) : home.pickCard?.kind === "allPicked" ? (
            <section aria-label="Your picks" style={{ ...card, border: "2px solid var(--cl-accent)" }}>
              <h2 style={{ fontSize: 20 }}>ALL PICKED — SEE YOU TOMORROW</h2>
              <Link href="/picks" style={{ minHeight: "var(--cl-tap)", display: "inline-flex", alignItems: "center", fontSize: 14, fontWeight: 700 }}>
                Review today&apos;s picks →
              </Link>
            </section>
          ) : home.pickCard?.kind === "closed" ? (
            <section aria-label="Your picks" style={card}>
              <h2 style={{ fontSize: 20 }}>PICKS ARE LOCKED FOR TODAY</h2>
              <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>Today&apos;s games have started. See you tomorrow.</p>
            </section>
          ) : null}

          {home.chat?.kind === "live" ? (
            <LiveChatPreview gameId={home.chat.gameId} matchup={matchupOf(home.chat.gameId)} messages={chatMessages} />
          ) : home.chat?.kind === "next" ? (
            <NextGamePreview gameId={home.chat.gameId} matchup={matchupOf(home.chat.gameId)} startsAt={home.chat.startsAt} />
          ) : null}
        </>
      )}

      <PollList limit={3} />

      <FeedTabs active={tab} basePath="/" />
      {fallbackNote ? (
        <p role="note" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
          {fallbackNote}
        </p>
      ) : null}
      <FeedList key={`${tab}-${feedTab}`} tab={feedTab} initial={feed} emptyMessage={EMPTY[feedTab]} />

      <footer style={{ fontSize: 12, color: "var(--cl-text-muted)", textAlign: "center", paddingTop: 8 }}>
        Not affiliated with MLB or any club.
      </footer>
    </main>
  );
}
