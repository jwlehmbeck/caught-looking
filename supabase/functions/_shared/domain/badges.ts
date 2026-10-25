/**
 * Badge rules (plan U6). Pure functions, no I/O.
 *
 * The database is the system of record: `private.badge_counts`,
 * `private.evaluate_badges_for_user` and `private.revoke_invalid_badges`
 * (migration 20261025130600) implement the same rules in SQL. Keep both
 * sides in step.
 *
 * Every rule is evaluated from the user's full history of scored picks, so
 * the result is a target state ("this user should hold Hot Streak ×2"),
 * not an event. Awarding means raising a count; revoking means lowering it
 * or removing the row. That makes a score correction safe: the badge goes
 * away only when its rule no longer holds.
 *
 * Rules:
 *   rookie_card     one-time   first scored pick (correct or wrong).
 *   caught_looking  one-time   first wrong pick. Playful, not a punishment.
 *   hot_streak      repeat     every 5th consecutive correct pick in game-end
 *                              order (5, 10, 15 …). Void picks are skipped,
 *                              a wrong pick ends the run.
 *   perfect_game    repeat     an official date with 5+ counted, scored games
 *                              where the user picked every one and got every
 *                              one right.
 *   upset_special   repeat     a correct pick for a team that under 30% of at
 *                              least 20 pickers chose at lock time.
 *   iron_man        one-time   30 consecutive game days (official dates with
 *                              counted games) with at least one scored pick.
 *                              Off days and the All-Star break are not game
 *                              days, so they do not break the run.
 *   ace             one-time   70%+ hit rate over 50+ scored picks in one
 *                              season (season 0 / lifetime does not count).
 */

import type { PickOutcome } from "./scoring.ts";

export const BADGE_SLUGS = [
  "rookie_card",
  "caught_looking",
  "hot_streak",
  "upset_special",
  "perfect_game",
  "iron_man",
  "ace",
] as const;

export type BadgeSlug = (typeof BADGE_SLUGS)[number];

export const REPEATABLE_BADGES: ReadonlySet<BadgeSlug> = new Set<BadgeSlug>([
  "hot_streak",
  "upset_special",
  "perfect_game",
]);

export const HOT_STREAK_LENGTH = 5;
export const PERFECT_GAME_MIN_GAMES = 5;
export const UPSET_MAX_SHARE = 0.3;
export const UPSET_MIN_PICKERS = 20;
export const IRON_MAN_DAYS = 30;
export const ACE_MIN_PICKS = 50;
export const ACE_MIN_RATE = 0.7;

export interface LockSplit {
  home: number;
  away: number;
  total: number;
}

/** One of the user's picks on a counted, scored (or void) game. */
export interface BadgePick {
  gameId: number;
  season: number;
  /** MLB officialDate, YYYY-MM-DD. */
  officialDate: string;
  /** ISO timestamp the game ended; orders streaks. */
  endedAt: string;
  outcome: PickOutcome;
  /** Which side the user took. */
  side: "home" | "away";
  /** The fan split snapshotted at lock, or null when none was taken. */
  lockSplit: LockSplit | null;
}

export interface BadgeInput {
  picks: readonly BadgePick[];
  /**
   * Number of counted, scored games per official date, for every date that
   * had one (not just the dates the user picked on). Perfect Game needs the
   * denominator and Iron Man needs the ordered list of game days.
   */
  gamesPerDate: Readonly<Record<string, number>>;
  /** Per-season scored/correct totals (season 0 = lifetime, ignored by Ace). */
  seasonStats: readonly { season: number; picks_scored: number; picks_correct: number }[];
  /** Badges the user already holds, with counts. */
  earned: Readonly<Partial<Record<BadgeSlug, number>>>;
}

export interface BadgeAward {
  slug: BadgeSlug;
  /** Count the user should now hold (1 for one-time badges). */
  timesEarned: number;
  /** How many were added by this evaluation (0 means the row already matched). */
  delta: number;
}

export interface BadgeRevocation {
  slug: BadgeSlug;
  /** The count that still holds; 0 means the badge is removed. */
  timesEarned: number;
}

// --- Target counts -----------------------------------------------------------

function scoredInOrder(picks: readonly BadgePick[]): BadgePick[] {
  return [...picks]
    .filter((p) => p.outcome !== "void")
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.gameId - b.gameId);
}

export function hotStreakCount(picks: readonly BadgePick[]): number {
  let run = 0;
  let count = 0;
  for (const p of scoredInOrder(picks)) {
    if (p.outcome === "correct") {
      run += 1;
      if (run % HOT_STREAK_LENGTH === 0) count += 1;
    } else {
      run = 0;
    }
  }
  return count;
}

export function perfectGameCount(picks: readonly BadgePick[], gamesPerDate: Readonly<Record<string, number>>): number {
  const byDate = new Map<string, { scored: number; correct: number }>();
  for (const p of picks) {
    if (p.outcome === "void") continue;
    const d = byDate.get(p.officialDate) ?? { scored: 0, correct: 0 };
    d.scored += 1;
    if (p.outcome === "correct") d.correct += 1;
    byDate.set(p.officialDate, d);
  }
  let count = 0;
  for (const [date, d] of byDate) {
    const games = gamesPerDate[date] ?? 0;
    if (games >= PERFECT_GAME_MIN_GAMES && d.scored === games && d.correct === games) count += 1;
  }
  return count;
}

export function isUpset(pick: Pick<BadgePick, "outcome" | "side" | "lockSplit">): boolean {
  if (pick.outcome !== "correct" || pick.lockSplit === null) return false;
  const { total } = pick.lockSplit;
  if (total < UPSET_MIN_PICKERS) return false;
  const mine = pick.lockSplit[pick.side];
  return mine / total < UPSET_MAX_SHARE;
}

export function upsetSpecialCount(picks: readonly BadgePick[]): number {
  return picks.filter(isUpset).length;
}

/** Longest run of consecutive game days on which the user has a scored pick. */
export function longestGameDayRun(picks: readonly BadgePick[], gamesPerDate: Readonly<Record<string, number>>): number {
  const gameDays = Object.keys(gamesPerDate)
    .filter((d) => (gamesPerDate[d] ?? 0) > 0)
    .sort();
  const picked = new Set(picks.filter((p) => p.outcome !== "void").map((p) => p.officialDate));
  let best = 0;
  let run = 0;
  for (const d of gameDays) {
    if (picked.has(d)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export function isAce(seasonStats: BadgeInput["seasonStats"]): boolean {
  return seasonStats.some(
    (s) => s.season !== 0 && s.picks_scored >= ACE_MIN_PICKS && s.picks_correct / s.picks_scored >= ACE_MIN_RATE,
  );
}

/** The count of each badge the user should hold given their whole history. */
export function badgeCounts(input: BadgeInput): Record<BadgeSlug, number> {
  const scored = input.picks.filter((p) => p.outcome !== "void");
  return {
    rookie_card: scored.length > 0 ? 1 : 0,
    caught_looking: scored.some((p) => p.outcome === "wrong") ? 1 : 0,
    hot_streak: hotStreakCount(input.picks),
    upset_special: upsetSpecialCount(input.picks),
    perfect_game: perfectGameCount(input.picks, input.gamesPerDate),
    iron_man: longestGameDayRun(input.picks, input.gamesPerDate) >= IRON_MAN_DAYS ? 1 : 0,
    ace: isAce(input.seasonStats) ? 1 : 0,
  };
}

// --- Award / revoke ----------------------------------------------------------

/**
 * Badges to add or increment. Never lowers a count: that is `revokeBadges`,
 * so a caller can choose to award only (normal scoring) or reconcile fully
 * (after a correction).
 */
export function evaluateBadges(input: BadgeInput): BadgeAward[] {
  const target = badgeCounts(input);
  const awards: BadgeAward[] = [];
  for (const slug of BADGE_SLUGS) {
    const have = input.earned[slug] ?? 0;
    const want = target[slug];
    if (want > have) awards.push({ slug, timesEarned: want, delta: want - have });
  }
  return awards;
}

/** Badges whose rule no longer holds at the count the user has. */
export function revokeBadges(input: BadgeInput): BadgeRevocation[] {
  const target = badgeCounts(input);
  const revoked: BadgeRevocation[] = [];
  for (const slug of BADGE_SLUGS) {
    const have = input.earned[slug] ?? 0;
    const want = target[slug];
    if (have > 0 && want < have) revoked.push({ slug, timesEarned: want });
  }
  return revoked;
}
