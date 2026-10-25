/**
 * Scoring rules (plan U5). Pure functions, no I/O.
 *
 * The database is the system of record: `private.score_game` and
 * `private.recompute_user_stats` (migration 20261025130500) implement the
 * same rules in SQL. These functions exist so the rules are unit-testable
 * and so the app can reproduce them (for example to show what a result
 * will do to a streak). Keep both sides in step.
 *
 * Rules:
 *   - A pick is `correct` when it names the winner, `wrong` otherwise.
 *   - A pick is `void` when the game is void (postponed, cancelled, tied),
 *     when the game does not count (spring training, All-Star), or when
 *     there is no result. Void picks do not count toward anything.
 *   - `current_streak` counts consecutive correct picks in game-end order;
 *     void picks are skipped, a wrong pick resets it to 0.
 *   - `game_day_streak` counts consecutive GAME DAYS (MLB official dates
 *     on which counted games were played) with at least one scored pick.
 *     Off days and the All-Star break do not break it because they are not
 *     game days.
 *   - Hit rate is correct / scored and unlocks at 10 scored picks.
 */

import type { AppState } from "./game-state.ts";

export type PickOutcome = "correct" | "wrong" | "void";

/** The scored picks a user needs before their hit rate is shown. */
export const HIT_RATE_UNLOCK_PICKS = 10;

export interface GameResult {
  provider: string;
  providerGameId: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  appState: AppState;
  countsForPicks: boolean;
}

export interface ScorablePick {
  teamId: number;
}

export interface PickStats {
  picks_scored: number;
  picks_correct: number;
  current_streak: number;
  best_streak: number;
  game_day_streak: number;
  /** YYYY-MM-DD of the last game day with a scored pick, or null. */
  last_pick_game_date: string | null;
}

export interface SeasonAndLifetime {
  season: PickStats;
  lifetime: PickStats;
}

export function emptyStats(): PickStats {
  return {
    picks_scored: 0,
    picks_correct: 0,
    current_streak: 0,
    best_streak: 0,
    game_day_streak: 0,
    last_pick_game_date: null,
  };
}

// --- Hashing -----------------------------------------------------------------

/**
 * 32-bit FNV-1a as 8 lower-case hex characters. Mirrors `private.fnv1a_hex`
 * in SQL byte for byte, so the app and the database agree on
 * `games.final_score_hash`.
 */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The winning team id from the scores, or null when there is no winner. */
export function winnerOf(game: Pick<GameResult, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore">): number | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore > game.awayScore) return game.homeTeamId;
  if (game.awayScore > game.homeScore) return game.awayTeamId;
  return null;
}

/** The string that is hashed. Exposed so SQL and tests can agree on it. */
export function finalScoreKey(game: GameResult): string {
  const winner = winnerOf(game);
  return `${game.provider}:${game.providerGameId}:${game.awayScore ?? ""}-${game.homeScore ?? ""}:${winner ?? ""}`;
}

/**
 * Stable hash of the final result: provider id, both scores and the winner.
 * The scorer's idempotency key. A score correction changes it; a repeat
 * poll with the same numbers does not.
 */
export function finalScoreHash(game: GameResult): string {
  return fnv1aHex(finalScoreKey(game));
}

// --- Outcomes ----------------------------------------------------------------

export function scorePick(pick: ScorablePick, game: GameResult): PickOutcome {
  if (game.appState === "void" || !game.countsForPicks) return "void";
  const winner = winnerOf(game);
  if (winner === null) return "void";
  return pick.teamId === winner ? "correct" : "wrong";
}

// --- Stats -------------------------------------------------------------------

/**
 * Game-day streak after a scored pick on `officialDate`.
 *
 * `gameDates` is the ordered list of distinct official dates on which
 * counted games have been played (the schedule as scored so far, including
 * `officialDate`). The streak continues when the previous game date in that
 * list is the user's last pick date.
 */
export function nextGameDayStreak(stats: PickStats, officialDate: string, gameDates: readonly string[]): {
  game_day_streak: number;
  last_pick_game_date: string;
} {
  const last = stats.last_pick_game_date;
  if (last === null) return { game_day_streak: 1, last_pick_game_date: officialDate };
  if (officialDate === last) return { game_day_streak: Math.max(1, stats.game_day_streak), last_pick_game_date: last };
  if (officialDate < last) {
    // A game that finished late (suspended, resumed days later). The full
    // SQL recompute orders by date; incrementally we leave the streak alone.
    return { game_day_streak: stats.game_day_streak, last_pick_game_date: last };
  }
  const sorted = [...new Set(gameDates)].sort();
  const idx = sorted.indexOf(officialDate);
  const previousGameDate = idx > 0 ? sorted[idx - 1] : null;
  if (previousGameDate === last) {
    return { game_day_streak: stats.game_day_streak + 1, last_pick_game_date: officialDate };
  }
  return { game_day_streak: 1, last_pick_game_date: officialDate };
}

export function applyOutcome(stats: PickStats, outcome: PickOutcome, officialDate: string, gameDates: readonly string[]): PickStats {
  if (outcome === "void") return { ...stats };
  const correct = outcome === "correct";
  const current_streak = correct ? stats.current_streak + 1 : 0;
  const day = nextGameDayStreak(stats, officialDate, gameDates);
  return {
    picks_scored: stats.picks_scored + 1,
    picks_correct: stats.picks_correct + (correct ? 1 : 0),
    current_streak,
    best_streak: Math.max(stats.best_streak, current_streak),
    game_day_streak: day.game_day_streak,
    last_pick_game_date: day.last_pick_game_date,
  };
}

/**
 * Applies one scored pick to a user's season and lifetime (season 0) rows.
 * `seasonGameDates` and `lifetimeGameDates` are the game-day lists for each
 * scope; when the lifetime list is omitted the season list is used.
 */
export function applyScoreToStats(
  stats: SeasonAndLifetime,
  outcome: PickOutcome,
  officialDate: string,
  seasonGameDates: readonly string[],
  lifetimeGameDates: readonly string[] = seasonGameDates,
): SeasonAndLifetime {
  return {
    season: applyOutcome(stats.season, outcome, officialDate, seasonGameDates),
    lifetime: applyOutcome(stats.lifetime, outcome, officialDate, lifetimeGameDates),
  };
}

/**
 * Rebuilds stats from scratch, the way `private.recompute_user_stats` does:
 * picks in game-end order for the pick streak, game dates for the day streak.
 */
export function foldStats(
  picks: readonly { outcome: PickOutcome; officialDate: string; endedAt: string }[],
  gameDates: readonly string[],
): PickStats {
  const ordered = [...picks].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  let stats = emptyStats();
  for (const p of ordered) {
    if (p.outcome === "void") continue;
    const correct = p.outcome === "correct";
    const current_streak = correct ? stats.current_streak + 1 : 0;
    stats = {
      ...stats,
      picks_scored: stats.picks_scored + 1,
      picks_correct: stats.picks_correct + (correct ? 1 : 0),
      current_streak,
      best_streak: Math.max(stats.best_streak, current_streak),
    };
  }
  // Day streak: the trailing run of game dates the user picked on.
  const pickedDates = new Set(ordered.filter((p) => p.outcome !== "void").map((p) => p.officialDate));
  const sortedGameDates = [...new Set(gameDates)].sort();
  const lastPicked = [...pickedDates].sort().at(-1) ?? null;
  let streak = 0;
  if (lastPicked !== null) {
    for (let i = sortedGameDates.indexOf(lastPicked); i >= 0; i -= 1) {
      if (!pickedDates.has(sortedGameDates[i])) break;
      streak += 1;
    }
  }
  return { ...stats, game_day_streak: streak, last_pick_game_date: lastPicked };
}

// --- Hit rate ----------------------------------------------------------------

/** Correct over scored as a 0–1 fraction; null before any pick is scored. */
export function hitRate(stats: Pick<PickStats, "picks_scored" | "picks_correct">): number | null {
  if (stats.picks_scored <= 0) return null;
  return stats.picks_correct / stats.picks_scored;
}

export function hitRateUnlocked(stats: Pick<PickStats, "picks_scored">): boolean {
  return stats.picks_scored >= HIT_RATE_UNLOCK_PICKS;
}

/** Copy for the hit-rate chip: "67%" once unlocked, "4 of 10 picks to unlock" before. */
export function hitRateLabel(stats: Pick<PickStats, "picks_scored" | "picks_correct">): string {
  if (!hitRateUnlocked(stats)) {
    return `${stats.picks_scored} of ${HIT_RATE_UNLOCK_PICKS} picks to unlock`;
  }
  const rate = hitRate(stats) ?? 0;
  return `${Math.round(rate * 100)}%`;
}
