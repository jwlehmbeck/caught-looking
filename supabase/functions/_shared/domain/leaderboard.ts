/**
 * Leaderboard rules (plan U6). Pure functions, no I/O.
 *
 * The database is the system of record: the materialized views
 * `private.season_leaderboard` and `private.fanbase_leaderboard`
 * (migration 20261025130600) implement the same rules in SQL. Keep both
 * sides in step.
 *
 * Rules:
 *   - Season board: 25+ scored picks in the season and an account at least
 *     3 days old. Ranked by hit rate, then total correct; equal on both
 *     shares a rank (1, 2, 2, 4).
 *   - Fan-base board: pools the picks of qualified users per favorite team.
 *     A team needs 5+ qualified users to appear. Same ranking.
 *   - Banned and deleted users never appear (the RPCs filter them).
 */

export const LEADERBOARD_MIN_PICKS = 25;
export const LEADERBOARD_MIN_ACCOUNT_DAYS = 3;
export const FANBASE_MIN_USERS = 5;

export interface LeaderboardRow {
  userId: string;
  username: string;
  favoriteTeamId: number | null;
  picksScored: number;
  picksCorrect: number;
}

export interface RankedRow extends LeaderboardRow {
  hitRate: number;
  rank: number;
  tied: boolean;
}

export interface FanBaseRow {
  teamId: number;
  qualifiedUsers: number;
  picksScored: number;
  picksCorrect: number;
  hitRate: number;
  rank: number;
  tied: boolean;
}

export function qualifies(
  stats: { picks_scored: number },
  accountAgeDays: number,
): boolean {
  return stats.picks_scored >= LEADERBOARD_MIN_PICKS && accountAgeDays >= LEADERBOARD_MIN_ACCOUNT_DAYS;
}

/** Picks still needed before the user can be ranked (0 once qualified). */
export function picksToQualify(stats: { picks_scored: number }): number {
  return Math.max(0, LEADERBOARD_MIN_PICKS - stats.picks_scored);
}

function rate(correct: number, scored: number): number {
  return scored > 0 ? correct / scored : 0;
}

/** Shared ranking: equal (rate, correct) → equal rank; the next rank skips. */
function assignRanks<T extends { hitRate: number; picksCorrect: number }>(rows: T[]): (T & { rank: number; tied: boolean })[] {
  const sorted = [...rows].sort((a, b) => b.hitRate - a.hitRate || b.picksCorrect - a.picksCorrect);
  const ranked = sorted.map((row, i) => {
    let rank = i + 1;
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.hitRate === row.hitRate && prev.picksCorrect === row.picksCorrect) {
        rank = -1; // filled below
      }
    }
    return { ...row, rank, tied: false };
  });
  for (let i = 1; i < ranked.length; i += 1) {
    if (ranked[i].rank === -1) ranked[i].rank = ranked[i - 1].rank;
  }
  const counts = new Map<number, number>();
  for (const r of ranked) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  for (const r of ranked) r.tied = (counts.get(r.rank) ?? 0) > 1;
  return ranked;
}

/**
 * Ranks already-qualified users. Filter with `qualifies` first; this
 * function does not know account ages.
 */
export function rankUsers(rows: readonly LeaderboardRow[]): RankedRow[] {
  const withRate = rows
    .filter((r) => r.picksScored >= LEADERBOARD_MIN_PICKS)
    .map((r) => ({ ...r, hitRate: rate(r.picksCorrect, r.picksScored) }));
  return assignRanks(withRate);
}

/** Pools qualified users' picks per favorite team; teams under 5 users drop out. */
export function fanBaseBoard(rows: readonly LeaderboardRow[]): FanBaseRow[] {
  const pools = new Map<number, { users: number; scored: number; correct: number }>();
  for (const r of rows) {
    if (r.favoriteTeamId === null || r.picksScored < LEADERBOARD_MIN_PICKS) continue;
    const p = pools.get(r.favoriteTeamId) ?? { users: 0, scored: 0, correct: 0 };
    p.users += 1;
    p.scored += r.picksScored;
    p.correct += r.picksCorrect;
    pools.set(r.favoriteTeamId, p);
  }
  const teams = [...pools.entries()]
    .filter(([, p]) => p.users >= FANBASE_MIN_USERS)
    .map(([teamId, p]) => ({
      teamId,
      qualifiedUsers: p.users,
      picksScored: p.scored,
      picksCorrect: p.correct,
      hitRate: rate(p.correct, p.scored),
    }));
  return assignRanks(teams);
}

/** "3" or "T-3" for display. */
export function rankLabel(rank: number, tied: boolean): string {
  return tied ? `T-${rank}` : String(rank);
}
