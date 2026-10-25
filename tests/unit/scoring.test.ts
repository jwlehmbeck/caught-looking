import { describe, expect, it } from "vitest";

import {
  HIT_RATE_UNLOCK_PICKS,
  applyOutcome,
  applyScoreToStats,
  emptyStats,
  finalScoreHash,
  finalScoreKey,
  fnv1aHex,
  foldStats,
  hitRate,
  hitRateLabel,
  hitRateUnlocked,
  scorePick,
  winnerOf,
  type GameResult,
  type PickOutcome,
  type PickStats,
} from "@shared/domain/scoring.ts";

const LAD = 14;
const NYY = 19;

function game(overrides: Partial<GameResult> = {}): GameResult {
  return {
    provider: "mlb",
    providerGameId: "745123",
    homeTeamId: LAD,
    awayTeamId: NYY,
    homeScore: 4,
    awayScore: 2,
    appState: "final",
    countsForPicks: true,
    ...overrides,
  };
}

describe("outcomes", () => {
  it("picking LAD when LAD wins 4-2 is correct", () => {
    expect(scorePick({ teamId: LAD }, game())).toBe("correct");
  });

  it("picking NYY when LAD wins is wrong", () => {
    expect(scorePick({ teamId: NYY }, game())).toBe("wrong");
  });

  it("a void game voids the pick whichever team was picked", () => {
    const g = game({ appState: "void", homeScore: null, awayScore: null });
    expect(scorePick({ teamId: LAD }, g)).toBe("void");
    expect(scorePick({ teamId: NYY }, g)).toBe("void");
  });

  it("a game that does not count (spring training) voids the pick", () => {
    expect(scorePick({ teamId: LAD }, game({ countsForPicks: false }))).toBe("void");
  });

  it("a tied result has no winner and voids the pick", () => {
    expect(winnerOf(game({ homeScore: 3, awayScore: 3 }))).toBeNull();
    expect(scorePick({ teamId: LAD }, game({ homeScore: 3, awayScore: 3 }))).toBe("void");
  });

  it("missing scores mean no winner", () => {
    expect(winnerOf(game({ homeScore: null }))).toBeNull();
    expect(scorePick({ teamId: LAD }, game({ awayScore: null }))).toBe("void");
  });
});

describe("final score hash", () => {
  it("matches the FNV-1a test vectors used by the SQL implementation", () => {
    expect(fnv1aHex("")).toBe("811c9dc5");
    expect(fnv1aHex("a")).toBe("e40c292c");
    expect(fnv1aHex("foobar")).toBe("bf9cf968");
  });

  it("is stable for the same result", () => {
    expect(finalScoreHash(game())).toBe(finalScoreHash(game()));
    expect(finalScoreHash(game())).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when the score flips", () => {
    const before = finalScoreHash(game({ homeScore: 4, awayScore: 2 }));
    const after = finalScoreHash(game({ homeScore: 2, awayScore: 5 }));
    expect(after).not.toBe(before);
  });

  it("changes when the margin changes even if the winner does not", () => {
    expect(finalScoreHash(game({ homeScore: 4, awayScore: 2 }))).not.toBe(
      finalScoreHash(game({ homeScore: 5, awayScore: 2 })),
    );
  });

  it("includes the provider game id so two games with the same score differ", () => {
    expect(finalScoreHash(game({ providerGameId: "1" }))).not.toBe(finalScoreHash(game({ providerGameId: "2" })));
  });

  it("hashes the same key shape the database builds", () => {
    expect(finalScoreKey(game())).toBe("mlb:745123:2-4:14");
  });
});

describe("stats", () => {
  const GAME_DATES = ["2027-04-01", "2027-04-02", "2027-04-04", "2027-04-06"];

  function fold(outcomes: PickOutcome[], dates: string[] = GAME_DATES): PickStats {
    let stats = emptyStats();
    outcomes.forEach((o, i) => {
      stats = applyOutcome(stats, o, dates[i] ?? dates.at(-1) ?? "2027-04-01", dates);
    });
    return stats;
  }

  it("a correct pick counts and starts a streak", () => {
    const s = applyOutcome(emptyStats(), "correct", "2027-04-01", GAME_DATES);
    expect(s).toMatchObject({
      picks_scored: 1,
      picks_correct: 1,
      current_streak: 1,
      best_streak: 1,
      game_day_streak: 1,
      last_pick_game_date: "2027-04-01",
    });
  });

  it("a wrong pick counts but resets the streak", () => {
    const s = fold(["correct", "correct", "wrong"]);
    expect(s.picks_scored).toBe(3);
    expect(s.picks_correct).toBe(2);
    expect(s.current_streak).toBe(0);
    expect(s.best_streak).toBe(2);
  });

  it("a void pick changes nothing", () => {
    const before = fold(["correct", "correct"]);
    const after = applyOutcome(before, "void", "2027-04-04", GAME_DATES);
    expect(after).toEqual(before);
  });

  it("a void in the middle does not break a pick streak", () => {
    const s = fold(["correct", "correct", "void", "correct"]);
    expect(s.current_streak).toBe(3);
    expect(s.best_streak).toBe(3);
    expect(s.picks_scored).toBe(3);
  });

  it("game-day streak counts consecutive game dates, skipping off days", () => {
    // 04-02 -> 04-04 has an off day between; both are consecutive game days.
    let s = applyOutcome(emptyStats(), "correct", "2027-04-02", GAME_DATES);
    s = applyOutcome(s, "wrong", "2027-04-04", GAME_DATES);
    s = applyOutcome(s, "correct", "2027-04-06", GAME_DATES);
    expect(s.game_day_streak).toBe(3);
    expect(s.last_pick_game_date).toBe("2027-04-06");
  });

  it("game-day streak resets when a game day is skipped", () => {
    let s = applyOutcome(emptyStats(), "correct", "2027-04-01", GAME_DATES);
    s = applyOutcome(s, "correct", "2027-04-04", GAME_DATES); // skipped 04-02
    expect(s.game_day_streak).toBe(1);
  });

  it("several picks on one game day count that day once", () => {
    let s = applyOutcome(emptyStats(), "correct", "2027-04-01", GAME_DATES);
    s = applyOutcome(s, "wrong", "2027-04-01", GAME_DATES);
    expect(s.game_day_streak).toBe(1);
    expect(s.picks_scored).toBe(2);
  });

  it("applies one outcome to season and lifetime rows together", () => {
    const stats = { season: emptyStats(), lifetime: { ...emptyStats(), picks_scored: 40, picks_correct: 30 } };
    const next = applyScoreToStats(stats, "correct", "2027-04-01", GAME_DATES);
    expect(next.season.picks_scored).toBe(1);
    expect(next.lifetime.picks_scored).toBe(41);
    expect(next.lifetime.picks_correct).toBe(31);
  });

  it("foldStats rebuilds the same numbers from scratch in game-end order", () => {
    const picks = [
      { outcome: "correct" as const, officialDate: "2027-04-06", endedAt: "2027-04-07T02:00:00Z" },
      { outcome: "wrong" as const, officialDate: "2027-04-04", endedAt: "2027-04-05T02:00:00Z" },
      { outcome: "void" as const, officialDate: "2027-04-02", endedAt: "2027-04-03T02:00:00Z" },
      { outcome: "correct" as const, officialDate: "2027-04-01", endedAt: "2027-04-02T02:00:00Z" },
    ];
    const s = foldStats(picks, GAME_DATES);
    expect(s).toEqual({
      picks_scored: 3,
      picks_correct: 2,
      current_streak: 1,
      best_streak: 1,
      game_day_streak: 2, // 04-06 and 04-04 picked; 04-02 was void
      last_pick_game_date: "2027-04-06",
    });
  });
});

describe("hit rate", () => {
  it("is null before any scored pick", () => {
    expect(hitRate(emptyStats())).toBeNull();
  });

  it("unlocks at exactly 10 scored picks", () => {
    expect(HIT_RATE_UNLOCK_PICKS).toBe(10);
    expect(hitRateUnlocked({ picks_scored: 9 })).toBe(false);
    expect(hitRateUnlocked({ picks_scored: 10 })).toBe(true);
  });

  it("labels the chip with progress before unlock and a percentage after", () => {
    expect(hitRateLabel({ picks_scored: 4, picks_correct: 3 })).toBe("4 of 10 picks to unlock");
    expect(hitRateLabel({ picks_scored: 12, picks_correct: 8 })).toBe("67%");
    expect(hitRate({ picks_scored: 12, picks_correct: 8 })).toBeCloseTo(0.6667, 3);
  });
});
