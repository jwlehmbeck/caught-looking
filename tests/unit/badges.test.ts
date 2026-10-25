import { describe, expect, it } from "vitest";

import {
  ACE_MIN_PICKS,
  IRON_MAN_DAYS,
  badgeCounts,
  evaluateBadges,
  hotStreakCount,
  isUpset,
  longestGameDayRun,
  perfectGameCount,
  revokeBadges,
  type BadgeInput,
  type BadgePick,
  type LockSplit,
} from "@shared/domain/badges.ts";
import type { PickOutcome } from "@shared/domain/scoring.ts";

let nextId = 1;

function day(n: number): string {
  // Season days starting 2027-04-01; n is a 0-based offset.
  const d = new Date(Date.UTC(2027, 3, 1 + n));
  return d.toISOString().slice(0, 10);
}

function pick(
  outcome: PickOutcome,
  opts: { date?: string; endedAt?: string; side?: "home" | "away"; split?: LockSplit | null } = {},
): BadgePick {
  const id = nextId++;
  const date = opts.date ?? day(0);
  return {
    gameId: id,
    season: 2027,
    officialDate: date,
    endedAt: opts.endedAt ?? `${date}T${String(id % 24).padStart(2, "0")}:00:00Z`,
    outcome,
    side: opts.side ?? "home",
    lockSplit: opts.split === undefined ? { home: 1, away: 1, total: 2 } : opts.split,
  };
}

/** A sequence of outcomes on successive days, one game per day, in order. */
function sequence(outcomes: PickOutcome[], startDay = 0): BadgePick[] {
  return outcomes.map((o, i) => pick(o, { date: day(startDay + i), endedAt: `${day(startDay + i)}T22:00:00Z` }));
}

function input(picks: BadgePick[], overrides: Partial<BadgeInput> = {}): BadgeInput {
  const gamesPerDate: Record<string, number> = {};
  for (const p of picks) gamesPerDate[p.officialDate] = (gamesPerDate[p.officialDate] ?? 0) + 1;
  return { picks, gamesPerDate, seasonStats: [], earned: {}, ...overrides };
}

describe("Rookie Card", () => {
  it("is awarded on the first scored pick, right or wrong", () => {
    expect(badgeCounts(input(sequence(["wrong"]))).rookie_card).toBe(1);
  });
  it("is not awarded for a void pick only", () => {
    expect(badgeCounts(input(sequence(["void"]))).rookie_card).toBe(0);
  });
});

describe("Caught Looking", () => {
  it("is awarded on the first wrong pick", () => {
    expect(badgeCounts(input(sequence(["correct", "wrong"]))).caught_looking).toBe(1);
  });
  it("is not awarded while every pick is right", () => {
    expect(badgeCounts(input(sequence(["correct", "correct", "void"]))).caught_looking).toBe(0);
  });
  it("is one-time: more wrong picks do not raise the count", () => {
    expect(badgeCounts(input(sequence(["wrong", "wrong", "wrong"]))).caught_looking).toBe(1);
  });
});

describe("Hot Streak", () => {
  it("5 correct in a row awards it once", () => {
    expect(hotStreakCount(sequence(["correct", "correct", "correct", "correct", "correct"]))).toBe(1);
  });
  it("a void in the middle does not break the run", () => {
    expect(hotStreakCount(sequence(["correct", "correct", "void", "correct", "correct", "correct"]))).toBe(1);
  });
  it("a wrong pick resets the run: 4 + wrong + 4 is not a streak", () => {
    const outcomes: PickOutcome[] = ["correct", "correct", "correct", "correct", "wrong", "correct", "correct", "correct", "correct"];
    expect(hotStreakCount(sequence(outcomes))).toBe(0);
  });
  it("is ordered by game end time, not by the order picks were made", () => {
    // Picked in one order, finished in another: the wrong pick ended last.
    const picks = [
      pick("wrong", { endedAt: "2027-04-05T23:00:00Z" }),
      ...[1, 2, 3, 4, 5].map((h) => pick("correct", { endedAt: `2027-04-05T0${h}:00:00Z` })),
    ];
    expect(hotStreakCount(picks)).toBe(1);
  });
  it("repeats every 5: a 10-game run counts twice", () => {
    expect(hotStreakCount(sequence(Array<PickOutcome>(10).fill("correct")))).toBe(2);
  });
});

describe("Perfect Game", () => {
  it("awards a day with 5 counted games, all picked, all right", () => {
    const picks = [1, 2, 3, 4, 5].map(() => pick("correct", { date: day(3) }));
    expect(perfectGameCount(picks, { [day(3)]: 5 })).toBe(1);
  });
  it("does not award a 4-game day", () => {
    const picks = [1, 2, 3, 4].map(() => pick("correct", { date: day(3) }));
    expect(perfectGameCount(picks, { [day(3)]: 4 })).toBe(0);
  });
  it("does not award when one game of the day was not picked", () => {
    const picks = [1, 2, 3, 4, 5].map(() => pick("correct", { date: day(3) }));
    expect(perfectGameCount(picks, { [day(3)]: 6 })).toBe(0);
  });
  it("does not award when one pick was wrong", () => {
    const picks = [...[1, 2, 3, 4].map(() => pick("correct", { date: day(3) })), pick("wrong", { date: day(3) })];
    expect(perfectGameCount(picks, { [day(3)]: 5 })).toBe(0);
  });
});

describe("Upset Special", () => {
  it("awards a correct pick that under 30% of 20+ pickers took", () => {
    expect(isUpset(pick("correct", { side: "away", split: { home: 15, away: 5, total: 20 } }))).toBe(true);
  });
  it("is not awarded when only 12 users picked the game", () => {
    expect(isUpset(pick("correct", { side: "away", split: { home: 10, away: 2, total: 12 } }))).toBe(false);
  });
  it("is not awarded at exactly 30%", () => {
    expect(isUpset(pick("correct", { side: "away", split: { home: 14, away: 6, total: 20 } }))).toBe(false);
  });
  it("is not awarded for a wrong pick or without a split", () => {
    expect(isUpset(pick("wrong", { side: "away", split: { home: 18, away: 2, total: 20 } }))).toBe(false);
    expect(isUpset(pick("correct", { side: "away", split: null }))).toBe(false);
  });
});

describe("Iron Man", () => {
  it("awards 30 consecutive game days with a pick", () => {
    const picks = sequence(Array<PickOutcome>(IRON_MAN_DAYS).fill("correct"));
    expect(badgeCounts(input(picks)).iron_man).toBe(1);
  });
  it("is unaffected by the All-Star break (dates without counted games)", () => {
    // 15 game days, a 4-day gap with no counted games, then 15 more.
    const first = sequence(Array<PickOutcome>(15).fill("wrong"), 0);
    const second = sequence(Array<PickOutcome>(15).fill("wrong"), 19);
    const picks = [...first, ...second];
    expect(longestGameDayRun(picks, input(picks).gamesPerDate)).toBe(30);
    expect(badgeCounts(input(picks)).iron_man).toBe(1);
  });
  it("is broken by a game day the user skipped", () => {
    const first = sequence(Array<PickOutcome>(15).fill("wrong"), 0);
    const second = sequence(Array<PickOutcome>(15).fill("wrong"), 16);
    const picks = [...first, ...second];
    const gamesPerDate = { ...input(picks).gamesPerDate, [day(15)]: 8 }; // games happened, no pick
    expect(longestGameDayRun(picks, gamesPerDate)).toBe(15);
    expect(badgeCounts({ ...input(picks), gamesPerDate }).iron_man).toBe(0);
  });
  it("is not awarded at 29 days", () => {
    const picks = sequence(Array<PickOutcome>(29).fill("correct"));
    expect(badgeCounts(input(picks)).iron_man).toBe(0);
  });
});

describe("Ace", () => {
  it("awards 70%+ over 50+ picks in a season", () => {
    const i = input([], { seasonStats: [{ season: 2027, picks_scored: 50, picks_correct: 35 }] });
    expect(badgeCounts(i).ace).toBe(1);
  });
  it("is not awarded at 69% or under 50 picks, and lifetime never counts", () => {
    expect(badgeCounts(input([], { seasonStats: [{ season: 2027, picks_scored: 100, picks_correct: 69 }] })).ace).toBe(0);
    expect(badgeCounts(input([], { seasonStats: [{ season: 2027, picks_scored: ACE_MIN_PICKS - 1, picks_correct: 49 }] })).ace).toBe(0);
    expect(badgeCounts(input([], { seasonStats: [{ season: 0, picks_scored: 200, picks_correct: 180 }] })).ace).toBe(0);
  });
  it("is revoked when a correction drops the rate below 70%", () => {
    const i = input([], {
      seasonStats: [{ season: 2027, picks_scored: 50, picks_correct: 34 }],
      earned: { ace: 1 },
    });
    expect(revokeBadges(i)).toEqual([{ slug: "ace", timesEarned: 0 }]);
  });
});

describe("evaluateBadges / revokeBadges", () => {
  it("returns only badges that are new or went up, with the delta", () => {
    const picks = sequence(["correct", "correct", "correct", "correct", "correct", "wrong"]);
    const awards = evaluateBadges(input(picks, { earned: { rookie_card: 1 } }));
    expect(awards).toEqual([
      { slug: "caught_looking", timesEarned: 1, delta: 1 },
      { slug: "hot_streak", timesEarned: 1, delta: 1 },
    ]);
  });
  it("a re-score that turns a correct pick wrong removes a badge only if its rule no longer holds", () => {
    const before = sequence(["correct", "correct", "correct", "correct", "correct"]);
    const earned = { rookie_card: 1, hot_streak: 1 };
    expect(revokeBadges(input(before, { earned }))).toEqual([]);
    const after = [...before];
    after[2] = { ...after[2], outcome: "wrong" };
    expect(revokeBadges(input(after, { earned }))).toEqual([{ slug: "hot_streak", timesEarned: 0 }]);
    // Rookie Card still holds: there are scored picks.
    expect(evaluateBadges(input(after, { earned })).map((a) => a.slug)).toEqual(["caught_looking"]);
  });
  it("lowers a repeatable count instead of removing it when some awards survive", () => {
    const picks = sequence(Array<PickOutcome>(10).fill("correct"));
    picks[7] = { ...picks[7], outcome: "wrong" };
    expect(revokeBadges(input(picks, { earned: { hot_streak: 2 } }))).toEqual([{ slug: "hot_streak", timesEarned: 1 }]);
  });
});
