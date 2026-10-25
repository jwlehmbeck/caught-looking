import { describe, expect, it } from "vitest";

import {
  FANBASE_MIN_USERS,
  LEADERBOARD_MIN_ACCOUNT_DAYS,
  LEADERBOARD_MIN_PICKS,
  fanBaseBoard,
  picksToQualify,
  qualifies,
  rankLabel,
  rankUsers,
  type LeaderboardRow,
} from "@shared/domain/leaderboard.ts";

function row(username: string, picksScored: number, picksCorrect: number, favoriteTeamId: number | null = 14): LeaderboardRow {
  return { userId: `id-${username}`, username, favoriteTeamId, picksScored, picksCorrect };
}

describe("qualification", () => {
  it("needs 25 scored picks and a 3-day-old account", () => {
    expect(qualifies({ picks_scored: 24 }, 10)).toBe(false);
    expect(qualifies({ picks_scored: 25 }, 10)).toBe(true);
    expect(qualifies({ picks_scored: 40 }, 2)).toBe(false);
    expect(qualifies({ picks_scored: 40 }, LEADERBOARD_MIN_ACCOUNT_DAYS)).toBe(true);
  });
  it("counts the picks still needed", () => {
    expect(picksToQualify({ picks_scored: 0 })).toBe(LEADERBOARD_MIN_PICKS);
    expect(picksToQualify({ picks_scored: 24 })).toBe(1);
    expect(picksToQualify({ picks_scored: 60 })).toBe(0);
  });
});

describe("rankUsers", () => {
  it("a user with 24 scored picks does not appear; with 25 they do", () => {
    expect(rankUsers([row("a", 24, 20)])).toHaveLength(0);
    expect(rankUsers([row("a", 25, 20)])).toHaveLength(1);
  });
  it("orders by hit rate, then total correct", () => {
    const ranked = rankUsers([row("low", 40, 20), row("high", 30, 24), row("mid", 50, 30)]);
    expect(ranked.map((r) => r.username)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it("same rate, more correct ranks higher", () => {
    const ranked = rankUsers([row("few", 30, 15), row("many", 60, 30)]);
    expect(ranked.map((r) => r.username)).toEqual(["many", "few"]);
  });
  it("two users with identical hit rate and correct count share a rank and the next rank skips", () => {
    const ranked = rankUsers([row("a", 30, 21), row("b", 30, 21), row("c", 30, 20)]);
    expect(ranked.map((r) => [r.username, r.rank, r.tied])).toEqual([
      ["a", 1, true],
      ["b", 1, true],
      ["c", 3, false],
    ]);
    expect(rankLabel(ranked[0].rank, ranked[0].tied)).toBe("T-1");
    expect(rankLabel(ranked[2].rank, ranked[2].tied)).toBe("3");
  });
});

describe("fanBaseBoard", () => {
  const fiveDodgers = [1, 2, 3, 4, 5].map((i) => row(`lad${i}`, 30, 18, 14));
  const fourYankees = [1, 2, 3, 4].map((i) => row(`nyy${i}`, 30, 24, 19));

  it("needs 5 qualified users per team", () => {
    const board = fanBaseBoard([...fiveDodgers, ...fourYankees]);
    expect(board.map((t) => t.teamId)).toEqual([14]);
    expect(board[0].qualifiedUsers).toBe(FANBASE_MIN_USERS);
  });
  it("pools picks only from qualified users", () => {
    const board = fanBaseBoard([...fiveDodgers, row("lad_rookie", 10, 10, 14)]);
    expect(board[0].picksScored).toBe(150);
    expect(board[0].picksCorrect).toBe(90);
    expect(board[0].hitRate).toBeCloseTo(0.6);
  });
  it("ranks teams by pooled hit rate and shares ties", () => {
    const fiveYankees = [...fourYankees, row("nyy5", 30, 24, 19)];
    const fiveMets = [1, 2, 3, 4, 5].map((i) => row(`nym${i}`, 30, 24, 20));
    const board = fanBaseBoard([...fiveDodgers, ...fiveYankees, ...fiveMets]);
    expect(board.map((t) => [t.teamId, t.rank, t.tied])).toEqual([
      [19, 1, true],
      [20, 1, true],
      [14, 3, false],
    ]);
  });
  it("ignores users with no favorite team", () => {
    expect(fanBaseBoard([1, 2, 3, 4, 5].map((i) => row(`none${i}`, 30, 20, null)))).toEqual([]);
  });
});
