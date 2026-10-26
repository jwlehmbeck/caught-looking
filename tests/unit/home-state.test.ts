import { describe, expect, it } from "vitest";

import { buildHomeState, liveLabel, stripItem, type HomeGame } from "@/lib/home/home-state";

const NOW = new Date("2026-07-14T20:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

let nextId = 1;
function game(over: Partial<HomeGame> & { home: number; away: number }): HomeGame {
  const id = over.id ?? nextId++;
  return {
    id,
    appState: "open",
    lockAt: at(2),
    gameDate: over.lockAt ?? at(2),
    detailedState: null,
    homeTeamId: over.home,
    awayTeamId: over.away,
    homeAbbr: `H${over.home}`,
    awayAbbr: `A${over.away}`,
    homeScore: null,
    awayScore: null,
    ...over,
  };
}

const LAD = 19;
const NYY = 14;

describe("buildHomeState", () => {
  it("with 3 live games and the user's team live, the chat preview shows the user's team's game", () => {
    const a = game({ home: 1, away: 2, appState: "live", lockAt: at(-2) });
    const b = game({ home: LAD, away: NYY, appState: "live", lockAt: at(-1) });
    const c = game({ home: 3, away: 4, appState: "live", lockAt: at(-3) });
    const s = buildHomeState({
      games: [a, b, c],
      pickedGameIds: [],
      favoriteTeamId: LAD,
      lastChatAt: { [a.id]: at(-0.01), [c.id]: at(-0.02) },
      now: NOW,
    });
    expect(s.chat).toEqual({ kind: "live", gameId: b.id });
  });

  it("without the user's team live, the chat preview follows the most recent chat", () => {
    const a = game({ home: 1, away: 2, appState: "live", lockAt: at(-2) });
    const c = game({ home: 3, away: 4, appState: "live", lockAt: at(-3) });
    const s = buildHomeState({
      games: [a, c],
      pickedGameIds: [],
      favoriteTeamId: LAD,
      lastChatAt: { [a.id]: at(-0.5), [c.id]: at(-0.02) },
      now: NOW,
    });
    expect(s.chat).toEqual({ kind: "live", gameId: c.id });
  });

  it("with no live game, the chat preview points at the next start time", () => {
    const later = game({ home: 1, away: 2, lockAt: at(4) });
    const sooner = game({ home: 3, away: 4, lockAt: at(1) });
    const s = buildHomeState({ games: [later, sooner], pickedGameIds: [], favoriteTeamId: null, now: NOW });
    expect(s.chat).toEqual({ kind: "next", gameId: sooner.id, startsAt: sooner.gameDate });
  });

  it("with no games today, the strip, pick card and chat preview are hidden", () => {
    const s = buildHomeState({ games: [], pickedGameIds: [], favoriteTeamId: LAD, now: NOW });
    expect(s.noGames).toBe(true);
    expect(s.strip).toEqual([]);
    expect(s.pickCard).toBeNull();
    expect(s.chat).toBeNull();
  });

  it("when all of today's open games are picked, the pick card says all picked", () => {
    const a = game({ home: 1, away: 2 });
    const b = game({ home: 3, away: 4, lockAt: at(3) });
    const s = buildHomeState({ games: [a, b], pickedGameIds: new Set([a.id, b.id]), favoriteTeamId: null, now: NOW });
    expect(s.pickCard).toEqual({ kind: "allPicked" });
  });

  it("when every game started without a pick, picks are closed rather than 'all picked'", () => {
    const a = game({ home: 1, away: 2, appState: "final", lockAt: at(-4) });
    const s = buildHomeState({ games: [a], pickedGameIds: [], favoriteTeamId: null, now: NOW });
    expect(s.pickCard).toEqual({ kind: "closed" });
  });

  it("the next unpicked game prefers the favorite team, then the earliest lock", () => {
    const early = game({ home: 1, away: 2, lockAt: at(1) });
    const fav = game({ home: 3, away: LAD, lockAt: at(5) });
    const mid = game({ home: 5, away: 6, lockAt: at(3) });
    const games = [mid, fav, early];
    expect(buildHomeState({ games, pickedGameIds: [], favoriteTeamId: LAD, now: NOW }).pickCard).toEqual({
      kind: "game",
      gameId: fav.id,
    });
    expect(buildHomeState({ games, pickedGameIds: [fav.id], favoriteTeamId: LAD, now: NOW }).pickCard).toEqual({
      kind: "game",
      gameId: early.id,
    });
    expect(buildHomeState({ games, pickedGameIds: [], favoriteTeamId: null, now: NOW }).pickCard).toEqual({
      kind: "game",
      gameId: early.id,
    });
  });

  it("skips games whose lock time has passed even if the poller hasn't flipped them yet", () => {
    const stale = game({ home: 1, away: 2, lockAt: at(-0.1) });
    const ok = game({ home: 3, away: 4, lockAt: at(2) });
    const s = buildHomeState({ games: [stale, ok], pickedGameIds: [], favoriteTeamId: null, now: NOW });
    expect(s.pickCard).toEqual({ kind: "game", gameId: ok.id });
  });

  it("orders the strip live, upcoming, final", () => {
    const fin = game({ home: 1, away: 2, appState: "final", lockAt: at(-5), homeScore: 4, awayScore: 5 });
    const up = game({ home: 3, away: 4, lockAt: at(2) });
    const live = game({ home: 5, away: 6, appState: "live", lockAt: at(-1), homeScore: 3, awayScore: 2 });
    const s = buildHomeState({ games: [fin, up, live], pickedGameIds: [], favoriteTeamId: null, now: NOW });
    expect(s.strip.map((i) => i.gameId)).toEqual([live.id, up.id, fin.id]);
    expect(s.strip[0].highlight).toBe(true);
    expect(s.strip[2].status).toEqual({ kind: "text", text: "FINAL" });
    expect(s.strip[1].status).toEqual({ kind: "time", iso: up.gameDate });
  });
});

describe("strip labels", () => {
  it("shows the detailed state next to LIVE when it says more than 'In Progress'", () => {
    expect(liveLabel("In Progress")).toBe("● LIVE");
    expect(liveLabel("Top 6th")).toBe("● LIVE · TOP 6TH");
    expect(liveLabel(null)).toBe("● LIVE");
  });

  it("puts the away team first with scores once there are scores", () => {
    const g = game({ home: LAD, away: NYY, appState: "live", homeScore: 3, awayScore: 2, homeAbbr: "LAD", awayAbbr: "NYY" });
    const item = stripItem(g);
    expect(item.matchup).toBe("NYY 2 · LAD 3");
    expect(item.label).toContain("NYY 2, LAD 3");
    const pre = stripItem(game({ home: 1, away: 2, homeAbbr: "SD", awayAbbr: "CHC" }));
    expect(pre.matchup).toBe("CHC · SD");
    expect(pre.label).toBe("CHC at SD");
  });
});

describe("bottom nav sections", async () => {
  const { navSection } = await import("@/components/bottom-nav");
  it("maps paths to the right item", () => {
    expect(navSection("/")).toBe("feed");
    expect(navSection("/post/12")).toBe("feed");
    expect(navSection("/post/new")).toBe("new");
    expect(navSection("/game/5")).toBe("games");
    expect(navSection("/picks")).toBe("games");
    expect(navSection("/leaderboard")).toBe("ranks");
    expect(navSection("/profile/settings")).toBe("profile");
    expect(navSection("/polls")).toBeNull();
  });
});
