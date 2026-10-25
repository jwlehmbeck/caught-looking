/**
 * Game page view model (plan U8). Pure: takes the game row, the viewer's
 * pick and season stats, and decides which sections render and what the
 * copy says. The page and the Vitest suite share it, so every app state has
 * a tested view.
 */

import type { AppState } from "@shared/domain/game-state.ts";
import { HIT_RATE_UNLOCK_PICKS, hitRateLabel, hitRateUnlocked } from "@shared/domain/scoring.ts";

export interface ViewTeam {
  id: number;
  abbreviation: string;
  name: string;
}

export interface ViewHighlight {
  title: string;
  url: string;
  durationSeconds?: number;
}

export interface ViewGame {
  id: number;
  appState: AppState;
  /** ISO timestamp. */
  lockAt: string;
  /** ISO timestamp of the scheduled first pitch. */
  gameDate: string;
  detailedState: string | null;
  home: ViewTeam;
  away: ViewTeam;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: number | null;
  countsForPicks: boolean;
  highlights: ViewHighlight[];
}

export interface ViewPick {
  teamId: number;
  status: "active" | "correct" | "wrong" | "void";
}

export interface ViewStats {
  picks_scored: number;
  picks_correct: number;
}

export interface ViewBadge {
  slug: string;
  name: string;
  description: string;
  timesEarned: number;
}

export interface GameViewInput {
  game: ViewGame;
  pick: ViewPick | null;
  /** The viewer's season stats (null before the first scored pick). */
  stats: ViewStats | null;
  /** Badges whose last_game_id is this game. */
  badges?: ViewBadge[];
  /** Epoch milliseconds; injected for tests, defaults to the current time. */
  now?: number;
}

export type Phase = "open" | "locked" | "live" | "suspended" | "final" | "void";

export type ResultTone = "hit" | "miss" | "none";

export interface ResultView {
  tone: ResultTone;
  title: string;
  detail: string;
}

export interface HeaderCenter {
  /** "time": the client formats gameDate in the device timezone. */
  kind: "time" | "score" | "text";
  top: string;
  bottom: string;
}

export interface GameViewModel {
  phase: Phase;
  header: HeaderCenter;
  /** One-line status under the header ("Picks are locked", "Top 5th", ...). */
  statusLine: string | null;
  showPickCard: boolean;
  /** Split bar + top predictors: only once the viewer has picked or the game has locked. */
  showSplitAndPredictors: boolean;
  showChatSlot: boolean;
  showResult: boolean;
  showHighlights: boolean;
  showFanEditsPlaceholder: boolean;
  countdownText: string | null;
  /** The viewer's pick, when there is one to show ("You picked LAD"). */
  pickLine: string | null;
  result: ResultView | null;
  hitRateLine: string | null;
  badges: ViewBadge[];
  voidText: string | null;
  suspendedText: string | null;
}

/** "Locks in 2h 14m" style copy; mirrors the pick card's wording. */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "Locked";
  if (msLeft < 60_000) return "Locks in under a minute";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Locks in ${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `Locks in ${hours}h ${minutes}m`;
  return `Locks in ${minutes}m`;
}

export function teamById(game: ViewGame, id: number | null | undefined): ViewTeam | null {
  if (id === game.home.id) return game.home;
  if (id === game.away.id) return game.away;
  return null;
}

/** "Postponed" or "Cancelled", from the provider's detailed state. */
export function voidKind(detailedState: string | null): "postponed" | "cancelled" | "tied" | "other" {
  const s = (detailedState ?? "").toLowerCase();
  if (s.includes("postpone")) return "postponed";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("tie")) return "tied";
  return "other";
}

export function phaseOf(game: ViewGame, now: number): Phase {
  switch (game.appState) {
    case "open":
      return now >= new Date(game.lockAt).getTime() ? "locked" : "open";
    case "locked":
      return "locked";
    case "live":
      return "live";
    case "suspended":
      return "suspended";
    case "final":
    case "scored":
      return "final";
    case "void":
      return "void";
  }
}

function scoreText(game: ViewGame): string {
  if (game.homeScore === null || game.awayScore === null) return "–";
  // Away first, matching the header's away-left layout.
  return `${game.awayScore}–${game.homeScore}`;
}

function headerFor(game: ViewGame, phase: Phase): HeaderCenter {
  switch (phase) {
    case "open":
      return { kind: "time", top: "", bottom: "" };
    case "locked":
      return game.homeScore !== null && game.awayScore !== null
        ? { kind: "score", top: scoreText(game), bottom: game.detailedState ?? "Locked" }
        : { kind: "time", top: "", bottom: "Locked" };
    case "live":
      return { kind: "score", top: scoreText(game), bottom: game.detailedState ?? "Live" };
    case "suspended":
      return { kind: "score", top: scoreText(game), bottom: "Suspended" };
    case "final":
      return { kind: "score", top: scoreText(game), bottom: "Final" };
    case "void": {
      const kind = voidKind(game.detailedState);
      return { kind: "text", top: kind === "postponed" ? "PPD" : kind === "cancelled" ? "CXL" : "VOID", bottom: kind === "postponed" ? "Postponed" : kind === "cancelled" ? "Cancelled" : "No result" };
    }
  }
}

export function resultFor(game: ViewGame, pick: ViewPick | null): ResultView {
  const winner = teamById(game, game.winnerTeamId);
  const picked = teamById(game, pick?.teamId);
  if (!pick || !picked) {
    return {
      tone: "none",
      title: "You didn't pick this one",
      detail: winner ? `${winner.abbreviation} took it.` : "No pick on record for this game.",
    };
  }
  if (pick.status === "correct") {
    return { tone: "hit", title: "You called it", detail: `You picked ${picked.abbreviation}.` };
  }
  if (pick.status === "wrong") {
    return {
      tone: "miss",
      title: "Caught looking",
      detail: `You picked ${picked.abbreviation}; ${winner?.abbreviation ?? "the other side"} took it.`,
    };
  }
  if (pick.status === "void") {
    return { tone: "none", title: "No result", detail: "This one didn't count toward your picks." };
  }
  // Final but not yet scored.
  return { tone: "none", title: "Final", detail: `You picked ${picked.abbreviation}. Scoring soon.` };
}

/** "Hit rate now 76% (13 of 17)" or the unlock counter. */
export function hitRateLine(stats: ViewStats | null): string | null {
  if (!stats) return null;
  if (!hitRateUnlocked(stats)) {
    const left = Math.max(HIT_RATE_UNLOCK_PICKS - stats.picks_scored, 0);
    return `${hitRateLabel(stats)} your hit rate (${left} more to go).`;
  }
  return `Hit rate now ${hitRateLabel(stats)} (${stats.picks_correct} of ${stats.picks_scored}).`;
}

export function buildGameView(input: GameViewInput): GameViewModel {
  const { game, pick, stats } = input;
  const now = input.now ?? Date.now();
  const badges = input.badges ?? [];
  const phase = phaseOf(game, now);
  const picked = teamById(game, pick?.teamId);
  const pickLine = picked && pick?.status !== "void" ? `You picked ${picked.abbreviation}.` : null;
  const hasPick = Boolean(picked);

  const base: GameViewModel = {
    phase,
    header: headerFor(game, phase),
    statusLine: null,
    showPickCard: false,
    showSplitAndPredictors: false,
    showChatSlot: false,
    showResult: false,
    showHighlights: false,
    showFanEditsPlaceholder: false,
    countdownText: null,
    pickLine,
    result: null,
    hitRateLine: null,
    badges: [],
    voidText: null,
    suspendedText: null,
  };

  switch (phase) {
    case "open":
      return {
        ...base,
        showPickCard: true,
        showSplitAndPredictors: hasPick,
        countdownText: formatCountdown(new Date(game.lockAt).getTime() - now),
        statusLine: game.countsForPicks ? null : "This game doesn't count toward picks.",
      };
    case "locked":
      return {
        ...base,
        statusLine: "Picks are locked",
        showSplitAndPredictors: true,
        showChatSlot: true,
        pickLine: pickLine ?? "You didn't pick this one.",
      };
    case "live":
      return {
        ...base,
        statusLine: game.detailedState ?? "Live",
        showSplitAndPredictors: true,
        showChatSlot: true,
        pickLine: pickLine ?? "You didn't pick this one.",
      };
    case "suspended":
      return {
        ...base,
        statusLine: "Suspended",
        suspendedText: "Suspended, pick pending. This game scores when it's completed.",
        showSplitAndPredictors: true,
        showChatSlot: true,
        pickLine: pickLine ?? "You didn't pick this one.",
      };
    case "final":
      return {
        ...base,
        statusLine: "Final",
        showResult: true,
        showSplitAndPredictors: true,
        showHighlights: game.highlights.length > 0,
        showFanEditsPlaceholder: true,
        result: resultFor(game, pick),
        hitRateLine: hasPick && pick?.status !== "void" ? hitRateLine(stats) : null,
        badges,
      };
    case "void": {
      const kind = voidKind(game.detailedState);
      return {
        ...base,
        statusLine: null,
        voidText:
          kind === "postponed"
            ? "Postponed — picks reopen when it's rescheduled."
            : kind === "cancelled"
              ? "Cancelled. This game won't count."
              : kind === "tied"
                ? "Ended in a tie. This game won't count."
                : "This game won't count.",
      };
    }
  }
}
