/**
 * Pure mapping from MLB Stats API JSON to provider-neutral ProviderGame /
 * ProviderHighlight values. No I/O here; client.ts does the fetching.
 *
 * MLB's status letters and gamePks never leave `providers/mlb/`.
 */

import type {
  ProviderGame,
  ProviderGameStatus,
  ProviderHighlight,
  ProviderSeasonType,
} from "../types.ts";

// --- Raw shapes (only the fields we read) ----------------------------------

export interface MlbStatus {
  abstractGameState?: string;
  codedGameState?: string;
  statusCode?: string;
  detailedState?: string;
  startTimeTBD?: boolean;
  reason?: string;
}

export interface MlbTeamSide {
  score?: number;
  team?: { id?: number; name?: string; abbreviation?: string };
  isWinner?: boolean;
}

export interface MlbHighlightItem {
  type?: string;
  title?: string;
  headline?: string;
  blurb?: string;
  duration?: string;
  slug?: string;
  url?: string;
  playbacks?: Array<{ name?: string; url?: string }>;
}

export interface MlbGame {
  gamePk: number | string;
  gameType?: string;
  season?: string | number;
  gameDate?: string;
  officialDate?: string;
  status?: MlbStatus;
  teams?: { home?: MlbTeamSide; away?: MlbTeamSide };
  linescore?: { teams?: { home?: { runs?: number }; away?: { runs?: number } } };
  doubleHeader?: string;
  gameNumber?: number;
  rescheduledFrom?: string;
  resumeDate?: string;
  content?: { highlights?: { highlights?: { items?: MlbHighlightItem[] } } };
}

export interface MlbSchedule {
  dates?: Array<{ date?: string; games?: MlbGame[] }>;
}

// --- Status ---------------------------------------------------------------

/**
 * MLB status, from most to least specific: `statusCode` (e.g. "FT", "DR",
 * "PW"), then `codedGameState` (single letter), then `abstractGameState`.
 *
 *   F*, O*            final        (FT = Final: Tied is the exception)
 *   D*                postponed
 *   C*                cancelled
 *   T*, U*            suspended
 *   I*, M*, N*, PW    live         (in progress, manager challenge, review, warmup)
 *   P*                pregame      (PR/PI/PO = delayed start, still pre-game)
 *   S*                scheduled
 *
 * `abstractGameState == "Final"` also covers Postponed and Cancelled, so it is
 * only ever a fallback and never decides a final on its own.
 */
export function mapStatus(status: MlbStatus | undefined): ProviderGameStatus {
  const code = (status?.statusCode || status?.codedGameState || "").toUpperCase();
  const coded = (status?.codedGameState || code.charAt(0)).toUpperCase();

  if (code === "FT") return "tied";
  if (code === "PW") return "live";

  switch (coded) {
    case "F":
    case "O":
      return "final";
    case "D":
      return "postponed";
    case "C":
      return "cancelled";
    case "T":
    case "U":
      return "suspended";
    case "I":
    case "M":
    case "N":
      return "live";
    case "P":
      return "pregame";
    case "S":
      return "scheduled";
  }

  switch ((status?.abstractGameState || "").toLowerCase()) {
    case "live":
      return "live";
    case "final":
      // Could be Postponed/Cancelled; without a code we cannot know, and a
      // wrong "final" would score picks. Treat as still scheduled.
      return /postpone/i.test(status?.detailedState ?? "")
        ? "postponed"
        : /cancel/i.test(status?.detailedState ?? "")
          ? "cancelled"
          : "scheduled";
    default:
      return "scheduled";
  }
}

export function mapSeasonType(gameType: string | undefined): ProviderSeasonType {
  switch ((gameType || "").toUpperCase()) {
    case "S":
      return "spring";
    case "R":
      return "regular";
    case "A":
      return "allstar";
    case "F": // Wild Card
    case "D": // Division Series
    case "L": // League Championship Series
    case "W": // World Series
      return "postseason";
    default:
      return "other";
  }
}

/** MLB abbreviations that differ from the ones in our teams table. */
const TEAM_ALIASES: Record<string, string> = {
  AZ: "ARI",
  ATH: "OAK",
};

export function mapTeamAbbreviation(abbreviation: string | undefined): string {
  const abbr = (abbreviation || "").toUpperCase();
  return TEAM_ALIASES[abbr] ?? abbr;
}

function side(game: MlbGame, which: "home" | "away") {
  const t = game.teams?.[which];
  const runs = game.linescore?.teams?.[which]?.runs;
  const score = typeof t?.score === "number" ? t.score : typeof runs === "number" ? runs : null;
  return { abbreviation: mapTeamAbbreviation(t?.team?.abbreviation), score };
}

function mapDoubleHeader(value: string | undefined): "N" | "Y" | "S" {
  const v = (value || "N").toUpperCase();
  return v === "Y" || v === "S" ? v : "N";
}

// --- Games ------------------------------------------------------------------

export function mapGame(game: MlbGame): ProviderGame {
  if (game.gamePk === undefined || game.gamePk === null || game.gamePk === "") {
    throw new Error("MLB game without gamePk");
  }
  if (!game.gameDate) {
    throw new Error(`MLB game ${game.gamePk} without gameDate`);
  }
  const home = side(game, "home");
  const away = side(game, "away");
  if (!home.abbreviation || !away.abbreviation) {
    throw new Error(`MLB game ${game.gamePk} without team abbreviations`);
  }
  const seasonRaw = Number(game.season);
  const season = Number.isFinite(seasonRaw) && seasonRaw > 0 ? seasonRaw : Number(game.gameDate.slice(0, 4));

  return {
    providerGameId: String(game.gamePk),
    season,
    seasonType: mapSeasonType(game.gameType),
    officialDate: game.officialDate || game.gameDate.slice(0, 10),
    gameDate: new Date(game.gameDate).toISOString(),
    startTimeTbd: Boolean(game.status?.startTimeTBD),
    status: mapStatus(game.status),
    detailedState: game.status?.detailedState || "",
    codedState: game.status?.statusCode || game.status?.codedGameState || null,
    homeTeam: home.abbreviation,
    awayTeam: away.abbreviation,
    homeScore: home.score,
    awayScore: away.score,
    doubleHeader: mapDoubleHeader(game.doubleHeader),
    gameNumber: typeof game.gameNumber === "number" && game.gameNumber > 0 ? game.gameNumber : 1,
    rescheduledFrom: game.rescheduledFrom ? game.rescheduledFrom.slice(0, 10) : null,
    resumeDate: game.resumeDate ? game.resumeDate.slice(0, 10) : null,
  };
}

/** Flattens a schedule response. Keeps duplicates; the domain layer dedupes. */
export function mapSchedule(schedule: MlbSchedule): ProviderGame[] {
  const out: ProviderGame[] = [];
  for (const day of schedule.dates ?? []) {
    for (const game of day.games ?? []) {
      out.push(mapGame(game));
    }
  }
  return out;
}

// --- Highlights -----------------------------------------------------------

const MEDIA_FILE = /\.(mp4|m3u8|mov|m4v|webm|ts)(\?|$)/i;
const MLB_PAGE = /^https:\/\/(www\.)?mlb\.com\//i;

/** "00:00:39" or "00:39" to seconds; undefined when unparseable. */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return seconds > 0 ? Math.round(seconds) : undefined;
}

/**
 * Highlight PAGE links only. Media file URLs (playbacks) are never stored:
 * the app links out to mlb.com, it does not host or embed MLB video.
 */
export function mapHighlightItem(item: MlbHighlightItem): ProviderHighlight | null {
  const title = (item.title || item.headline || "").trim();
  if (!title) return null;

  let url: string | null = null;
  if (item.url && MLB_PAGE.test(item.url) && !MEDIA_FILE.test(item.url)) {
    url = item.url;
  } else if (item.slug && /^[a-z0-9-]+$/i.test(item.slug)) {
    url = `https://www.mlb.com/video/${item.slug}`;
  }
  if (!url) return null;

  const durationSeconds = parseDuration(item.duration);
  return durationSeconds === undefined ? { title, url } : { title, url, durationSeconds };
}

export function mapHighlights(game: Pick<MlbGame, "content">): ProviderHighlight[] {
  const items = game.content?.highlights?.highlights?.items ?? [];
  const out: ProviderHighlight[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type && item.type !== "video") continue;
    const mapped = mapHighlightItem(item);
    if (mapped && !seen.has(mapped.url)) {
      seen.add(mapped.url);
      out.push(mapped);
    }
  }
  return out;
}

/** Highlights keyed by provider game id, from a hydrated schedule response. */
export function mapScheduleHighlights(schedule: MlbSchedule): Map<string, ProviderHighlight[]> {
  const out = new Map<string, ProviderHighlight[]>();
  for (const day of schedule.dates ?? []) {
    for (const game of day.games ?? []) {
      if (game.gamePk === undefined || game.gamePk === null) continue;
      const highlights = mapHighlights(game);
      if (highlights.length > 0) out.set(String(game.gamePk), highlights);
    }
  }
  return out;
}
