import { describe, expect, it } from "vitest";

import {
  addDays,
  computeLockAt,
  dedupeSchedule,
  deriveAppState,
  localDate,
  pickScheduleEntry,
  reopensPicks,
  resolveLockAt,
  type AppState,
} from "@shared/domain/game-state.ts";
import { planGameUpdate } from "@shared/domain/poll-plan.ts";
import { mapGame, mapSchedule, type MlbGame, type MlbSchedule } from "@shared/providers/mlb/map.ts";
import type { ProviderGame } from "@shared/providers/types.ts";

import finalTied from "../fixtures/mlb/final-tied.json";
import finalGame from "../fixtures/mlb/final.json";
import live from "../fixtures/mlb/live.json";
import postponed from "../fixtures/mlb/postponed.json";
import rescheduled from "../fixtures/mlb/rescheduled-duplicate.json";
import scheduled from "../fixtures/mlb/scheduled.json";
import suspended from "../fixtures/mlb/suspended.json";

const FIRST_PITCH = new Date("2026-04-15T23:10:00Z");
const MORNING = new Date("2026-04-15T15:00:00Z");
const EVENING = new Date("2026-04-16T01:30:00Z");

function game(overrides: Partial<ProviderGame> = {}): ProviderGame {
  return { ...mapGame(scheduled as MlbGame), ...overrides };
}

describe("computeLockAt", () => {
  it("is the scheduled first pitch", () => {
    expect(computeLockAt(game()).toISOString()).toBe(FIRST_PITCH.toISOString());
  });

  it("follows a start time moved 30 minutes earlier", () => {
    const moved = game({ gameDate: "2026-04-15T22:40:00Z" });
    expect(computeLockAt(moved).toISOString()).toBe("2026-04-15T22:40:00.000Z");
    expect(resolveLockAt({ game: moved, prevState: "open", prevLockAt: FIRST_PITCH, nextState: "open", now: MORNING }).toISOString()).toBe(
      "2026-04-15T22:40:00.000Z",
    );
  });
});

describe("deriveAppState", () => {
  it("happy path: a scheduled game before first pitch is open", () => {
    expect(deriveAppState(null, game(), MORNING)).toBe("open");
    expect(deriveAppState("open", game(), MORNING)).toBe("open");
  });

  it("locks at first pitch even if the provider still says scheduled", () => {
    expect(deriveAppState("open", game(), FIRST_PITCH)).toBe("locked");
    expect(deriveAppState("open", game({ status: "pregame" }), new Date(FIRST_PITCH.getTime() + 60_000))).toBe("locked");
  });

  it("locks when the first poll shows live, before the scheduled start", () => {
    const early = game({ status: "live" });
    expect(deriveAppState("open", early, MORNING)).toBe("live");
    const lockAt = resolveLockAt({ game: early, prevState: "open", prevLockAt: FIRST_PITCH, nextState: "live", now: MORNING });
    expect(lockAt.toISOString()).toBe(MORNING.toISOString());
  });

  it("freezes lock_at once locked, even if the schedule later moves", () => {
    const lockAt = resolveLockAt({
      game: game({ gameDate: "2026-04-16T00:10:00Z" }),
      prevState: "locked",
      prevLockAt: FIRST_PITCH,
      nextState: "locked",
      now: EVENING,
    });
    expect(lockAt.toISOString()).toBe(FIRST_PITCH.toISOString());
  });

  it("does not reopen a locked game whose start is pushed back", () => {
    const pushed = game({ gameDate: "2026-04-16T02:00:00Z" });
    expect(deriveAppState("locked", pushed, EVENING)).toBe("locked");
    expect(deriveAppState("live", pushed, EVENING)).toBe("locked");
  });

  it("live game maps to live", () => {
    expect(deriveAppState("locked", mapGame(live as MlbGame), EVENING)).toBe("live");
  });

  it("Postponed (abstract Final, coded D) maps to void, not final", () => {
    const g = mapGame(postponed as MlbGame);
    expect(deriveAppState("open", g, MORNING)).toBe("void");
    expect(deriveAppState("locked", g, EVENING)).toBe("void");
    expect(deriveAppState(null, g, EVENING)).toBe("void");
  });

  it("cancelled maps to void", () => {
    expect(deriveAppState("open", game({ status: "cancelled" }), MORNING)).toBe("void");
  });

  it("Final: Tied maps to void", () => {
    expect(deriveAppState("live", mapGame(finalTied as MlbGame), EVENING)).toBe("void");
  });

  it("Suspended maps to suspended, and its resumption days later goes live then final", () => {
    const s = mapGame(suspended as MlbGame);
    expect(deriveAppState("live", s, EVENING)).toBe("suspended");
    const resumeDay = new Date("2026-04-18T21:00:00Z");
    expect(deriveAppState("suspended", s, resumeDay)).toBe("suspended");
    expect(deriveAppState("suspended", { ...s, status: "live" }, resumeDay)).toBe("live");
    expect(deriveAppState("live", { ...s, status: "final", homeScore: 4, awayScore: 1 }, resumeDay)).toBe("final");
    // The lock from the first day is kept across the suspension.
    const lockAt = resolveLockAt({
      game: { ...s, status: "final" },
      prevState: "suspended",
      prevLockAt: FIRST_PITCH,
      nextState: "final",
      now: resumeDay,
    });
    expect(lockAt.toISOString()).toBe(FIRST_PITCH.toISOString());
  });

  it("Final maps to final; the poller never sets scored", () => {
    const f = mapGame(finalGame as MlbGame);
    expect(deriveAppState("live", f, EVENING)).toBe("final");
    expect(deriveAppState("final", f, EVENING)).toBe("final");
    const states: AppState[] = ["open", "locked", "live", "suspended", "final", "void"];
    for (const prev of states) expect(deriveAppState(prev, f, EVENING)).not.toBe("scored");
  });

  it("preserves scored when the game is still final", () => {
    const f = mapGame(finalGame as MlbGame);
    expect(deriveAppState("scored", f, EVENING)).toBe("scored");
    // and keeps it through a provider glitch that reports scheduled again
    expect(deriveAppState("scored", { ...f, status: "scheduled" }, EVENING)).toBe("scored");
  });

  it("a score correction to a tie voids a scored game", () => {
    expect(deriveAppState("scored", game({ status: "tied" }), EVENING)).toBe("void");
  });

  it("a void game reappearing scheduled on a later date returns to open", () => {
    const tomorrow = game({ officialDate: "2026-04-16", gameDate: "2026-04-16T17:10:00Z" });
    expect(deriveAppState("void", tomorrow, EVENING)).toBe("open");
    expect(reopensPicks("void", "open")).toBe(true);
    expect(reopensPicks("open", "open")).toBe(false);
    expect(reopensPicks(null, "open")).toBe(false);
  });
});

describe("pickScheduleEntry / dedupeSchedule", () => {
  const entries = mapSchedule(rescheduled as MlbSchedule);

  it("keeps the entry with the latest officialDate when one id appears twice", () => {
    const dupes = entries.filter((g) => g.providerGameId === "745011");
    expect(dupes).toHaveLength(2);
    const chosen = pickScheduleEntry(dupes);
    expect(chosen.officialDate).toBe("2026-04-16");
    expect(chosen.status).toBe("scheduled");
    expect(pickScheduleEntry([...dupes].reverse())).toEqual(chosen);
  });

  it("dedupes a whole schedule", () => {
    const deduped = dedupeSchedule(entries);
    expect(deduped.map((g) => g.providerGameId).sort()).toEqual(["745011", "745012"]);
  });

  it("throws on an empty list", () => {
    expect(() => pickScheduleEntry([])).toThrow();
  });

  it("a game postponed today and rescheduled tomorrow ends open and stays there across polls", () => {
    const now = new Date("2026-04-15T20:00:00Z");
    const chosen = pickScheduleEntry(entries.filter((g) => g.providerGameId === "745011"));

    // First poll: never seen before.
    let state = deriveAppState(null, chosen, now);
    expect(state).toBe("open");
    // The row previously held the postponed state (void) from an earlier poll.
    state = deriveAppState("void", chosen, now);
    expect(state).toBe("open");
    // Repeated polls stay open and do not flap.
    for (let i = 0; i < 5; i++) {
      state = deriveAppState(state, chosen, new Date(now.getTime() + i * 120_000));
      expect(state).toBe("open");
    }
    expect(computeLockAt(chosen).toISOString()).toBe("2026-04-16T17:10:00.000Z");
  });
});

describe("planGameUpdate", () => {
  const teamIds = new Map<string, number>([
    ["ARI", 1],
    ["LAD", 14],
    ["SEA", 25],
    ["OAK", 20],
  ]);

  it("builds an open row for a new scheduled game", () => {
    const plan = planGameUpdate({ provider: "mlb", game: game(), existing: null, teamIds, now: MORNING });
    expect(plan.kind).toBe("upsert");
    if (plan.kind !== "upsert") return;
    expect(plan.row).toMatchObject({
      provider: "mlb",
      provider_game_id: "745001",
      app_state: "open",
      lock_at: FIRST_PITCH.toISOString(),
      home_team_id: 14,
      away_team_id: 1,
      season_type: "regular",
      double_header: "N",
      game_number: 1,
    });
    expect(plan.row.ended_at).toBeUndefined();
    expect(plan.row.highlights).toBeUndefined();
    expect(plan.reopened).toBe(false);
  });

  it("stores highlights and ended_at when a game becomes final", () => {
    const f = mapGame(finalGame as MlbGame);
    const plan = planGameUpdate({
      provider: "mlb",
      game: f,
      existing: { app_state: "live", lock_at: FIRST_PITCH.toISOString(), highlights: null },
      teamIds,
      highlights: [{ title: "x", url: "https://www.mlb.com/video/x" }],
      now: EVENING,
    });
    if (plan.kind !== "upsert") throw new Error("expected upsert");
    expect(plan.row.app_state).toBe("final");
    expect(plan.row.ended_at).toBe(EVENING.toISOString());
    expect(plan.row.highlights).toHaveLength(1);
    expect(plan.row.lock_at).toBe(FIRST_PITCH.toISOString());
  });

  it("does not stamp ended_at again on a game that is already scored", () => {
    const f = mapGame(finalGame as MlbGame);
    const plan = planGameUpdate({
      provider: "mlb",
      game: f,
      existing: { app_state: "scored", lock_at: FIRST_PITCH.toISOString(), highlights: null },
      teamIds,
      now: EVENING,
    });
    if (plan.kind !== "upsert") throw new Error("expected upsert");
    expect(plan.row.app_state).toBe("scored");
    expect(plan.row.ended_at).toBeUndefined();
  });

  it("flags the void -> open reopening", () => {
    const plan = planGameUpdate({
      provider: "mlb",
      game: game({ officialDate: "2026-04-16", gameDate: "2026-04-16T17:10:00Z" }),
      existing: { app_state: "void", lock_at: FIRST_PITCH.toISOString(), highlights: null },
      teamIds,
      now: EVENING,
    });
    if (plan.kind !== "upsert") throw new Error("expected upsert");
    expect(plan.row.app_state).toBe("open");
    expect(plan.reopened).toBe(true);
  });

  it("skips games whose teams are not in the teams table (All-Star squads, college opponents)", () => {
    const plan = planGameUpdate({
      provider: "mlb",
      game: game({ homeTeam: "NL", awayTeam: "AL" }),
      existing: null,
      teamIds,
      now: MORNING,
    });
    expect(plan).toEqual({ kind: "skip", reason: "unknown team AL @ NL" });
  });
});

describe("dates", () => {
  it("uses MLB's day (America/New_York)", () => {
    // 03:30 UTC on the 16th is still the evening of the 15th in New York.
    expect(localDate(new Date("2026-04-16T03:30:00Z"))).toBe("2026-04-15");
    expect(localDate(new Date("2026-04-16T04:30:00Z"))).toBe("2026-04-16");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
