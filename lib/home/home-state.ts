/**
 * Pure rules for the home screen (plan U7): which games go in the strip and
 * how they are labelled, which game the "Make your pick" card shows, which
 * live game the chat preview follows, and whether today has any games at all.
 * No I/O, so it is unit-tested directly.
 */
import type { AppState } from "@shared/domain/game-state.ts";

export interface HomeGame {
  id: number;
  appState: AppState;
  /** ISO timestamps. */
  lockAt: string;
  gameDate: string;
  detailedState: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface HomeInput {
  games: readonly HomeGame[];
  /** Game ids the viewer has picked (any status). */
  pickedGameIds: ReadonlySet<number> | readonly number[];
  favoriteTeamId: number | null;
  /** Last live chat message per game id (ISO). Games with no messages can be left out. */
  lastChatAt?: Readonly<Record<number, string | null | undefined>>;
  now: Date;
}

/** What the small status line of a strip item says. `time` is rendered in the viewer's timezone. */
export type StripStatus =
  | { kind: "live"; text: string }
  | { kind: "time"; iso: string }
  | { kind: "text"; text: string };

export interface StripItem {
  gameId: number;
  status: StripStatus;
  /** "NYY 2 · LAD 3" once there is a score, "CHC · SD" before. Away team first. */
  matchup: string;
  /** Full sentence for screen readers. */
  label: string;
  /** Live games get the accent outline. */
  highlight: boolean;
}

export type PickCardState =
  | { kind: "game"; gameId: number }
  | { kind: "allPicked" }
  /** Nothing left to pick and the viewer did not pick everything (games already started). */
  | { kind: "closed" };

export type ChatPreviewState =
  | { kind: "live"; gameId: number }
  | { kind: "next"; gameId: number; startsAt: string }
  | { kind: "none" };

export interface HomeState {
  noGames: boolean;
  strip: StripItem[];
  pickCard: PickCardState | null;
  chat: ChatPreviewState | null;
}

const LIVE_STATES: ReadonlySet<AppState> = new Set<AppState>(["live"]);
/** Chat is open but the first pitch may not have been thrown yet. */
const CHAT_OPEN_STATES: ReadonlySet<AppState> = new Set<AppState>(["live", "locked"]);
const FINAL_STATES: ReadonlySet<AppState> = new Set<AppState>(["final", "scored"]);

/** MLB detailed states that just mean "in progress" and add nothing to "LIVE". */
const PLAIN_LIVE = new Set(["in progress", "live", "warmup", ""]);

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function involves(game: HomeGame, teamId: number | null): boolean {
  return teamId !== null && (game.homeTeamId === teamId || game.awayTeamId === teamId);
}

function hasScore(g: HomeGame): boolean {
  return g.homeScore !== null && g.awayScore !== null;
}

function stripOrder(state: AppState): number {
  if (state === "live" || state === "locked" || state === "suspended") return 0;
  if (state === "open") return 1;
  if (FINAL_STATES.has(state)) return 2;
  return 3;
}

export function liveLabel(detailedState: string | null): string {
  const d = (detailedState ?? "").trim();
  return PLAIN_LIVE.has(d.toLowerCase()) ? "● LIVE" : `● LIVE · ${d.toUpperCase()}`;
}

export function stripStatus(g: HomeGame): StripStatus {
  switch (g.appState) {
    case "live":
      return { kind: "live", text: liveLabel(g.detailedState) };
    case "open":
    case "locked":
      return { kind: "time", iso: g.gameDate };
    case "suspended":
      return { kind: "text", text: "SUSPENDED" };
    case "final":
    case "scored":
      return { kind: "text", text: "FINAL" };
    case "void":
      return { kind: "text", text: (g.detailedState ?? "Postponed").toUpperCase() };
  }
}

export function stripItem(g: HomeGame): StripItem {
  const scored = hasScore(g) && g.appState !== "open" && g.appState !== "void";
  const matchup = scored
    ? `${g.awayAbbr} ${g.awayScore} · ${g.homeAbbr} ${g.homeScore}`
    : `${g.awayAbbr} · ${g.homeAbbr}`;
  const status = stripStatus(g);
  const statusWords =
    status.kind === "live" ? status.text.replace("● ", "").toLowerCase() : status.kind === "text" ? status.text.toLowerCase() : "starts soon";
  const label = scored
    ? `${g.awayAbbr} ${g.awayScore}, ${g.homeAbbr} ${g.homeScore}, ${statusWords}`
    : `${g.awayAbbr} at ${g.homeAbbr}${status.kind === "time" ? "" : `, ${statusWords}`}`;
  return { gameId: g.id, status, matchup, label, highlight: LIVE_STATES.has(g.appState) };
}

/** Earliest first, the favorite team's game winning ties of "which one first". */
function byFavoriteThenStart(favoriteTeamId: number | null) {
  return (a: HomeGame, b: HomeGame) => {
    const fa = involves(a, favoriteTeamId) ? 0 : 1;
    const fb = involves(b, favoriteTeamId) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return ms(a.lockAt) - ms(b.lockAt) || a.id - b.id;
  };
}

export function buildHomeState(input: HomeInput): HomeState {
  const { games, favoriteTeamId, now } = input;
  const picked = input.pickedGameIds instanceof Set ? input.pickedGameIds : new Set(input.pickedGameIds as readonly number[]);
  const lastChatAt = input.lastChatAt ?? {};
  const nowMs = now.getTime();

  if (games.length === 0) {
    return { noGames: true, strip: [], pickCard: null, chat: null };
  }

  const strip = [...games]
    .sort((a, b) => stripOrder(a.appState) - stripOrder(b.appState) || ms(a.gameDate) - ms(b.gameDate) || a.id - b.id)
    .map(stripItem);

  // Pick card: the next open game the viewer hasn't picked.
  const pickable = games.filter((g) => g.appState === "open" && ms(g.lockAt) > nowMs);
  const unpicked = pickable.filter((g) => !picked.has(g.id)).sort(byFavoriteThenStart(favoriteTeamId));
  let pickCard: PickCardState;
  if (unpicked[0]) {
    pickCard = { kind: "game", gameId: unpicked[0].id };
  } else {
    // Nothing left to pick. If the viewer got some in, that's "all picked";
    // if every game started without a pick from them, say picks are closed.
    const pickedToday = games.some((g) => picked.has(g.id));
    pickCard = pickedToday ? { kind: "allPicked" } : { kind: "closed" };
  }

  // Chat preview: favorite team's game when it is live, else the live game
  // with the most recent chat, else the earliest live game.
  const live = games.filter((g) => LIVE_STATES.has(g.appState));
  const chatOpen = live.length > 0 ? live : games.filter((g) => CHAT_OPEN_STATES.has(g.appState));
  let chat: ChatPreviewState;
  if (chatOpen.length > 0) {
    const fav = chatOpen.find((g) => involves(g, favoriteTeamId));
    const chosen =
      fav ??
      [...chatOpen].sort((a, b) => {
        const ca = lastChatAt[a.id] ? ms(lastChatAt[a.id] as string) : Number.NEGATIVE_INFINITY;
        const cb = lastChatAt[b.id] ? ms(lastChatAt[b.id] as string) : Number.NEGATIVE_INFINITY;
        if (ca !== cb) return cb - ca;
        return ms(a.gameDate) - ms(b.gameDate) || a.id - b.id;
      })[0];
    chat = { kind: "live", gameId: chosen.id };
  } else {
    const next = games
      .filter((g) => g.appState === "open" && ms(g.gameDate) > nowMs)
      .sort((a, b) => ms(a.gameDate) - ms(b.gameDate) || a.id - b.id)[0];
    chat = next ? { kind: "next", gameId: next.id, startsAt: next.gameDate } : { kind: "none" };
  }

  return { noGames: false, strip, pickCard, chat };
}
