import { describe, expect, it } from "vitest";

import { createMlbProvider, gamesUrl, MlbProviderError, scheduleUrl } from "@shared/providers/mlb/client.ts";
import {
  mapGame,
  mapHighlights,
  mapSchedule,
  mapSeasonType,
  mapStatus,
  mapTeamAbbreviation,
  parseDuration,
  type MlbGame,
  type MlbSchedule,
} from "@shared/providers/mlb/map.ts";

import allStar from "../fixtures/mlb/all-star.json";
import doubleheader from "../fixtures/mlb/doubleheader-split.json";
import finalTied from "../fixtures/mlb/final-tied.json";
import finalGame from "../fixtures/mlb/final.json";
import live from "../fixtures/mlb/live.json";
import postponed from "../fixtures/mlb/postponed.json";
import rescheduled from "../fixtures/mlb/rescheduled-duplicate.json";
import scheduled from "../fixtures/mlb/scheduled.json";
import spring from "../fixtures/mlb/spring-training.json";
import suspended from "../fixtures/mlb/suspended.json";

describe("mapStatus", () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ codedGameState: "S", statusCode: "S" }, "scheduled"],
    [{ codedGameState: "P", statusCode: "P" }, "pregame"],
    [{ codedGameState: "P", statusCode: "PR" }, "pregame"],
    [{ codedGameState: "P", statusCode: "PW" }, "live"],
    [{ codedGameState: "I", statusCode: "I" }, "live"],
    [{ codedGameState: "I", statusCode: "IR" }, "live"],
    [{ codedGameState: "M", statusCode: "MA" }, "live"],
    [{ codedGameState: "F", statusCode: "F" }, "final"],
    [{ codedGameState: "F", statusCode: "FR" }, "final"],
    [{ codedGameState: "O", statusCode: "O" }, "final"],
    [{ codedGameState: "F", statusCode: "FT" }, "tied"],
    [{ codedGameState: "D", statusCode: "DR" }, "postponed"],
    [{ codedGameState: "D", statusCode: "DI" }, "postponed"],
    [{ codedGameState: "C", statusCode: "CR" }, "cancelled"],
    [{ codedGameState: "U", statusCode: "UR" }, "suspended"],
    [{ codedGameState: "T", statusCode: "TR" }, "suspended"],
  ];
  it.each(cases)("maps %o to %s", (status, expected) => {
    expect(mapStatus(status)).toBe(expected);
  });

  it("falls back to codedGameState when statusCode is missing", () => {
    expect(mapStatus({ codedGameState: "F" })).toBe("final");
    expect(mapStatus({ codedGameState: "D" })).toBe("postponed");
  });

  it("never turns a bare abstract Final into final", () => {
    expect(mapStatus({ abstractGameState: "Final", detailedState: "Postponed" })).toBe("postponed");
    expect(mapStatus({ abstractGameState: "Final", detailedState: "Cancelled" })).toBe("cancelled");
    expect(mapStatus({ abstractGameState: "Final" })).toBe("scheduled");
    expect(mapStatus(undefined)).toBe("scheduled");
  });
});

describe("mapSeasonType", () => {
  it("classifies MLB gameType letters", () => {
    expect(mapSeasonType("S")).toBe("spring");
    expect(mapSeasonType("R")).toBe("regular");
    expect(mapSeasonType("A")).toBe("allstar");
    for (const t of ["F", "D", "L", "W"]) expect(mapSeasonType(t)).toBe("postseason");
    expect(mapSeasonType("E")).toBe("other");
    expect(mapSeasonType(undefined)).toBe("other");
  });
});

describe("mapTeamAbbreviation", () => {
  it("maps MLB's AZ and ATH onto our ARI and OAK", () => {
    expect(mapTeamAbbreviation("AZ")).toBe("ARI");
    expect(mapTeamAbbreviation("ATH")).toBe("OAK");
    expect(mapTeamAbbreviation("LAD")).toBe("LAD");
    expect(mapTeamAbbreviation("kc")).toBe("KC");
  });
});

describe("mapGame", () => {
  it("maps a scheduled game", () => {
    const g = mapGame(scheduled as MlbGame);
    expect(g).toMatchObject({
      providerGameId: "745001",
      season: 2026,
      seasonType: "regular",
      officialDate: "2026-04-15",
      gameDate: "2026-04-15T23:10:00.000Z",
      startTimeTbd: false,
      status: "scheduled",
      detailedState: "Scheduled",
      codedState: "S",
      homeTeam: "LAD",
      awayTeam: "ARI",
      homeScore: null,
      awayScore: null,
      doubleHeader: "N",
      gameNumber: 1,
      rescheduledFrom: null,
      resumeDate: null,
    });
  });

  it("maps a live game with its linescore", () => {
    const g = mapGame(live as MlbGame);
    expect(g.status).toBe("live");
    expect(g.homeScore).toBe(3);
    expect(g.awayScore).toBe(2);
  });

  it("falls back to linescore runs when teams.score is missing", () => {
    const raw = structuredClone(live) as MlbGame;
    delete raw.teams!.home!.score;
    delete raw.teams!.away!.score;
    const g = mapGame(raw);
    expect(g.homeScore).toBe(3);
    expect(g.awayScore).toBe(2);
  });

  it("maps a final game and the Athletics alias", () => {
    const g = mapGame(finalGame as MlbGame);
    expect(g.status).toBe("final");
    expect(g.awayTeam).toBe("OAK");
    expect(g.homeTeam).toBe("SEA");
    expect(g.homeScore).toBe(6);
    expect(g.awayScore).toBe(4);
  });

  it("maps Final: Tied to tied, not final", () => {
    expect(mapGame(finalTied as MlbGame).status).toBe("tied");
  });

  it("maps Postponed (abstract Final, coded D) to postponed, not final", () => {
    const g = mapGame(postponed as MlbGame);
    expect(g.status).toBe("postponed");
    expect(g.codedState).toBe("DR");
  });

  it("maps Suspended with its resume date", () => {
    const g = mapGame(suspended as MlbGame);
    expect(g.status).toBe("suspended");
    expect(g.resumeDate).toBe("2026-04-18");
  });

  it("flags spring training and All-Star games", () => {
    expect(mapGame(spring as MlbGame).seasonType).toBe("spring");
    expect(mapGame(allStar as MlbGame).seasonType).toBe("allstar");
  });

  it("keeps rescheduledFrom as a date", () => {
    const g = mapGame((rescheduled as MlbSchedule).dates![1].games![0]);
    expect(g.rescheduledFrom).toBe("2026-04-15");
  });

  it("throws on a game without a gamePk or gameDate", () => {
    expect(() => mapGame({ gamePk: "" } as MlbGame)).toThrow(/gamePk/);
    expect(() => mapGame({ gamePk: 1 } as MlbGame)).toThrow(/gameDate/);
  });
});

describe("mapSchedule", () => {
  it("yields two games for a split doubleheader with game numbers 1 and 2", () => {
    const games = mapSchedule(doubleheader as MlbSchedule);
    expect(games).toHaveLength(2);
    expect(games.map((g) => g.providerGameId)).toEqual(["745007", "745008"]);
    expect(games.map((g) => g.doubleHeader)).toEqual(["S", "S"]);
    expect(games.map((g) => g.gameNumber)).toEqual([1, 2]);
    expect(games[0].gameDate < games[1].gameDate).toBe(true);
  });

  it("keeps duplicate gamePks for the domain layer to resolve", () => {
    const games = mapSchedule(rescheduled as MlbSchedule);
    expect(games.filter((g) => g.providerGameId === "745011")).toHaveLength(2);
  });
});

describe("mapHighlights", () => {
  it("stores mlb.com page links, never media files", () => {
    const highlights = mapHighlights(finalGame as MlbGame);
    expect(highlights).toEqual([
      { title: "Mariners walk it off in the 9th", url: "https://www.mlb.com/video/mariners-walk-it-off-in-the-9th", durationSeconds: 39 },
      { title: "Condensed Game: ATH@SEA 4/15/26", url: "https://www.mlb.com/video/condensed-game-ath-sea-4-15-26", durationSeconds: 492 },
    ]);
    for (const h of highlights) {
      expect(h.url).toMatch(/^https:\/\/www\.mlb\.com\//);
      expect(h.url).not.toMatch(/\.(mp4|m3u8)/);
    }
  });

  it("returns nothing for a game without content", () => {
    expect(mapHighlights(scheduled as MlbGame)).toEqual([]);
  });

  it("parses durations", () => {
    expect(parseDuration("00:00:39")).toBe(39);
    expect(parseDuration("01:02:03")).toBe(3723);
    expect(parseDuration("x")).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
  });
});

describe("createMlbProvider", () => {
  function fakeFetch(body: unknown, ok = true, status = 200) {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return { ok, status, json: async () => body };
    };
    return { fetch, calls };
  }

  it("builds the schedule URL with the hydrate list", () => {
    const url = scheduleUrl("2026-04-15", "2026-04-16");
    expect(url).toContain("https://statsapi.mlb.com/api/v1/schedule?");
    expect(url).toContain("sportId=1");
    expect(url).toContain("startDate=2026-04-15");
    expect(url).toContain("endDate=2026-04-16");
    expect(decodeURIComponent(url)).toContain("hydrate=linescore,team,game(content(highlights(highlights)))");
    expect(decodeURIComponent(gamesUrl(["1", "2"]))).toContain("gamePks=1,2");
  });

  it("maps a schedule through the injected fetch", async () => {
    const { fetch, calls } = fakeFetch(doubleheader);
    const provider = createMlbProvider({ fetch });
    const games = await provider.schedule("2026-04-15", "2026-04-16");
    expect(games).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it("returns highlights for one game", async () => {
    const { fetch } = fakeFetch({ dates: [{ games: [finalGame] }] });
    const provider = createMlbProvider({ fetch });
    const highlights = await provider.highlights("745003");
    expect(highlights).toHaveLength(2);
    expect(await provider.linescores([])).toEqual([]);
  });

  it("throws MlbProviderError on HTTP errors, timeouts and malformed bodies", async () => {
    await expect(createMlbProvider({ fetch: fakeFetch({}, false, 503).fetch }).schedule("a", "b")).rejects.toBeInstanceOf(
      MlbProviderError,
    );
    await expect(createMlbProvider({ fetch: fakeFetch({ nope: true }).fetch }).schedule("a", "b")).rejects.toThrow(
      /malformed/,
    );
    const timeout = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    await expect(createMlbProvider({ fetch: timeout }).schedule("a", "b")).rejects.toThrow(/request failed/);
  });
});
