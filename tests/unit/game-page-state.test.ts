import { describe, expect, it } from "vitest";

import {
  buildGameView,
  formatCountdown,
  hitRateLine,
  phaseOf,
  resultFor,
  voidKind,
  type ViewGame,
  type ViewPick,
} from "@/lib/game/view-state";

const NOW = Date.parse("2026-10-21T22:00:00Z");
const NYY = { id: 147, abbreviation: "NYY", name: "Yankees" };
const LAD = { id: 119, abbreviation: "LAD", name: "Dodgers" };

function game(overrides: Partial<ViewGame> = {}): ViewGame {
  return {
    id: 1,
    appState: "open",
    lockAt: "2026-10-22T00:08:00Z",
    gameDate: "2026-10-22T00:08:00Z",
    detailedState: "Scheduled",
    home: LAD,
    away: NYY,
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
    countsForPicks: true,
    highlights: [],
    ...overrides,
  };
}

const finalGame = (): ViewGame =>
  game({
    appState: "scored",
    detailedState: "Final",
    homeScore: 4,
    awayScore: 2,
    winnerTeamId: LAD.id,
    highlights: [{ title: "Ohtani homers", url: "https://www.mlb.com/video/ohtani-homers", durationSeconds: 34 }],
  });

describe("formatCountdown", () => {
  it("counts down in hours and minutes", () => {
    expect(formatCountdown(2 * 3_600_000 + 14 * 60_000)).toBe("Locks in 2h 14m");
    expect(formatCountdown(9 * 60_000)).toBe("Locks in 9m");
    expect(formatCountdown(30_000)).toBe("Locks in under a minute");
    expect(formatCountdown(26 * 3_600_000)).toBe("Locks in 1d 2h");
    expect(formatCountdown(0)).toBe("Locked");
  });
});

describe("phaseOf", () => {
  it("treats an open game past lock_at as locked even before the poller runs", () => {
    expect(phaseOf(game(), NOW)).toBe("open");
    expect(phaseOf(game(), Date.parse("2026-10-22T00:08:00Z"))).toBe("locked");
  });

  it("folds final and scored into one view phase", () => {
    expect(phaseOf(game({ appState: "final" }), NOW)).toBe("final");
    expect(phaseOf(game({ appState: "scored" }), NOW)).toBe("final");
  });
});

describe("open game", () => {
  it("shows the pick card and countdown but hides split and predictors before a pick", () => {
    const view = buildGameView({ game: game(), pick: null, stats: null, now: NOW });
    expect(view.phase).toBe("open");
    expect(view.showPickCard).toBe(true);
    expect(view.showSplitAndPredictors).toBe(false);
    expect(view.showChatSlot).toBe(false);
    expect(view.showResult).toBe(false);
    expect(view.countdownText).toBe("Locks in 2h 8m");
    expect(view.header.kind).toBe("time");
    expect(view.pickLine).toBeNull();
  });

  it("reveals split and predictors once the viewer has picked", () => {
    const pick: ViewPick = { teamId: LAD.id, status: "active" };
    const view = buildGameView({ game: game(), pick, stats: null, now: NOW });
    expect(view.showSplitAndPredictors).toBe(true);
    expect(view.pickLine).toBe("You picked LAD.");
  });

  it("flags a game that doesn't count", () => {
    const view = buildGameView({ game: game({ countsForPicks: false }), pick: null, stats: null, now: NOW });
    expect(view.statusLine).toMatch(/doesn't count/);
  });
});

describe("locked and live games", () => {
  it("locked: says picks are locked, shows split, predictors and the chat slot", () => {
    const view = buildGameView({ game: game({ appState: "locked" }), pick: null, stats: null, now: NOW });
    expect(view.phase).toBe("locked");
    expect(view.statusLine).toBe("Picks are locked");
    expect(view.showPickCard).toBe(false);
    expect(view.showSplitAndPredictors).toBe(true);
    expect(view.showChatSlot).toBe(true);
    expect(view.countdownText).toBeNull();
    expect(view.pickLine).toBe("You didn't pick this one.");
  });

  it("live: puts the score and detailed state in the header", () => {
    const view = buildGameView({
      game: game({ appState: "live", detailedState: "In Progress", homeScore: 3, awayScore: 1 }),
      pick: { teamId: NYY.id, status: "active" },
      stats: null,
      now: NOW,
    });
    expect(view.phase).toBe("live");
    expect(view.header).toEqual({ kind: "score", top: "1–3", bottom: "In Progress" });
    expect(view.statusLine).toBe("In Progress");
    expect(view.pickLine).toBe("You picked NYY.");
    expect(view.showChatSlot).toBe(true);
    expect(view.showResult).toBe(false);
  });
});

describe("suspended game", () => {
  it("shows 'Suspended, pick pending' and no result card", () => {
    const view = buildGameView({
      game: game({ appState: "suspended", detailedState: "Suspended: Rain", homeScore: 2, awayScore: 2 }),
      pick: { teamId: LAD.id, status: "active" },
      stats: null,
      now: NOW,
    });
    expect(view.phase).toBe("suspended");
    expect(view.suspendedText).toMatch(/^Suspended, pick pending/);
    expect(view.showResult).toBe(false);
    expect(view.result).toBeNull();
    expect(view.header.bottom).toBe("Suspended");
  });
});

describe("final game", () => {
  it("happy path: a correct pick shows 'You called it', the new hit rate and highlights", () => {
    const view = buildGameView({
      game: finalGame(),
      pick: { teamId: LAD.id, status: "correct" },
      stats: { picks_scored: 17, picks_correct: 13 },
      badges: [{ slug: "hot_streak", name: "Hot Streak", description: "Five in a row.", timesEarned: 1 }],
      now: NOW,
    });
    expect(view.phase).toBe("final");
    expect(view.header).toEqual({ kind: "score", top: "2–4", bottom: "Final" });
    expect(view.showResult).toBe(true);
    expect(view.result).toEqual({ tone: "hit", title: "You called it", detail: "You picked LAD." });
    expect(view.hitRateLine).toBe("Hit rate now 76% (13 of 17).");
    expect(view.showHighlights).toBe(true);
    expect(view.showFanEditsPlaceholder).toBe(true);
    expect(view.showSplitAndPredictors).toBe(true);
    expect(view.showChatSlot).toBe(false);
    expect(view.badges.map((b) => b.slug)).toEqual(["hot_streak"]);
  });

  it("a wrong pick is 'Caught looking' and names the winner", () => {
    const view = buildGameView({
      game: finalGame(),
      pick: { teamId: NYY.id, status: "wrong" },
      stats: { picks_scored: 4, picks_correct: 2 },
      now: NOW,
    });
    expect(view.result).toEqual({
      tone: "miss",
      title: "Caught looking",
      detail: "You picked NYY; LAD took it.",
    });
    // Under 10 scored picks the hit rate is still locked.
    expect(view.hitRateLine).toBe("4 of 10 picks to unlock your hit rate (6 more to go).");
  });

  it("no pick: 'You didn't pick this one' with no hit-rate line", () => {
    const view = buildGameView({ game: finalGame(), pick: null, stats: { picks_scored: 12, picks_correct: 9 }, now: NOW });
    expect(view.result?.tone).toBe("none");
    expect(view.result?.title).toBe("You didn't pick this one");
    expect(view.result?.detail).toBe("LAD took it.");
    expect(view.hitRateLine).toBeNull();
  });

  it("final but not yet scored says scoring is on its way", () => {
    const g = finalGame();
    g.appState = "final";
    expect(resultFor(g, { teamId: LAD.id, status: "active" })).toEqual({
      tone: "none",
      title: "Final",
      detail: "You picked LAD. Scoring soon.",
    });
  });

  it("hides the highlights section when the poller stored none", () => {
    const view = buildGameView({ game: finalGame(), pick: null, stats: null, now: NOW });
    const noClips = buildGameView({ game: { ...finalGame(), highlights: [] }, pick: null, stats: null, now: NOW });
    expect(view.showHighlights).toBe(true);
    expect(noClips.showHighlights).toBe(false);
  });
});

describe("void game", () => {
  it("postponed: void message, no result card, no pick card", () => {
    const view = buildGameView({
      game: game({ appState: "void", detailedState: "Postponed" }),
      pick: { teamId: LAD.id, status: "void" },
      stats: null,
      now: NOW,
    });
    expect(view.phase).toBe("void");
    expect(view.voidText).toBe("Postponed — picks reopen when it's rescheduled.");
    expect(view.showResult).toBe(false);
    expect(view.result).toBeNull();
    expect(view.showPickCard).toBe(false);
    expect(view.showSplitAndPredictors).toBe(false);
    expect(view.header).toEqual({ kind: "text", top: "PPD", bottom: "Postponed" });
    expect(view.pickLine).toBeNull();
  });

  it("cancelled and tied games get their own wording", () => {
    expect(buildGameView({ game: game({ appState: "void", detailedState: "Cancelled" }), pick: null, stats: null, now: NOW }).voidText).toBe(
      "Cancelled. This game won't count.",
    );
    expect(buildGameView({ game: game({ appState: "void", detailedState: "Final: Tied" }), pick: null, stats: null, now: NOW }).voidText).toBe(
      "Ended in a tie. This game won't count.",
    );
    expect(voidKind(null)).toBe("other");
  });
});

describe("hitRateLine", () => {
  it("is null without stats", () => {
    expect(hitRateLine(null)).toBeNull();
  });
});

describe("copy rules", () => {
  it("never says 'bet' in any state", () => {
    const states: ViewGame["appState"][] = ["open", "locked", "live", "suspended", "final", "scored", "void"];
    for (const appState of states) {
      const view = buildGameView({
        game: game({ appState, detailedState: "Postponed", homeScore: 1, awayScore: 0, winnerTeamId: LAD.id }),
        pick: { teamId: NYY.id, status: appState === "scored" ? "wrong" : "active" },
        stats: { picks_scored: 10, picks_correct: 5 },
        now: NOW,
      });
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/\bbet\b/i);
    }
  });
});
