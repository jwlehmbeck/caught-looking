/**
 * Game-state machine (plan U4). Pure functions; the poller feeds them.
 *
 *   open      → locked      now >= gameDate, or the provider shows live
 *   open      → open        start time moves; lock_at follows
 *   open/locked → void      postponed / cancelled
 *   locked    → live        in progress
 *   live      → suspended   → live when resumed
 *   live      → final       final / game over / completed early
 *   live      → void        final: tied
 *   final     → scored      set by the SCORER only, never here
 *   void      → open        the same provider id reappears scheduled later
 *
 * `app_state` is derived from the provider's neutral status; raw provider
 * codes never reach this file.
 */

import type { ProviderGame } from "../providers/types.ts";

export type AppState = "open" | "locked" | "live" | "suspended" | "final" | "scored" | "void";

/** States in which picks can no longer be made or changed. */
export const LOCKED_STATES: ReadonlySet<AppState> = new Set<AppState>([
  "locked",
  "live",
  "suspended",
  "final",
  "scored",
]);

export function isLockedState(state: AppState): boolean {
  return LOCKED_STATES.has(state);
}

/** The scheduled lock: a pick locks at the game's current scheduled start. */
export function computeLockAt(game: ProviderGame): Date {
  return new Date(game.gameDate);
}

/**
 * Derives the next app state from the previous one and a fresh provider
 * snapshot. `prev` is null for a game we have never stored.
 */
export function deriveAppState(prev: AppState | null, game: ProviderGame, now: Date): AppState {
  switch (game.status) {
    case "final":
      // The scorer owns the final → scored edge. A routine poll must not undo it.
      return prev === "scored" ? "scored" : "final";

    case "tied":
    case "postponed":
    case "cancelled":
      return "void";

    case "suspended":
      return "suspended";

    case "live":
      return "live";

    case "scheduled":
    case "pregame": {
      // A completed-and-scored game that the provider briefly reports as
      // scheduled again is a data glitch; keep the scored result.
      if (prev === "scored") return "scored";
      // Once locked, a start-time change does not reopen picks. Only a
      // void game that reappears on the schedule returns to open.
      if (prev !== null && prev !== "open" && prev !== "void") return "locked";
      return now.getTime() >= computeLockAt(game).getTime() ? "locked" : "open";
    }
  }
}

export interface LockAtInput {
  game: ProviderGame;
  prevState: AppState | null;
  prevLockAt: Date | null;
  nextState: AppState;
  now: Date;
}

/**
 * The lock time to store alongside `nextState`.
 *
 * - While open (or void), lock_at tracks the scheduled start, so schedule
 *   changes move it. A void game carries the schedule too, so that a
 *   reopened game shows its new start.
 * - On the transition INTO a locked state, lock_at is the earlier of the
 *   scheduled start and now (the first poll that saw the game live).
 * - After that it is frozen: the fairness record of when picks closed.
 */
export function resolveLockAt(input: LockAtInput): Date {
  const scheduled = computeLockAt(input.game);
  if (!isLockedState(input.nextState)) {
    return scheduled;
  }
  const wasLocked = input.prevState !== null && isLockedState(input.prevState);
  if (wasLocked && input.prevLockAt) {
    return input.prevLockAt;
  }
  return input.now.getTime() < scheduled.getTime() ? input.now : scheduled;
}

/** True exactly on the void → open edge, the only time picks reopen. */
export function reopensPicks(prev: AppState | null, next: AppState): boolean {
  return prev === "void" && next === "open";
}

/**
 * When one provider id appears more than once in a schedule response
 * (postponed today, rescheduled tomorrow), the entry with the latest
 * officialDate is the one that matters.
 */
export function pickScheduleEntry(entries: readonly ProviderGame[]): ProviderGame {
  if (entries.length === 0) {
    throw new Error("pickScheduleEntry needs at least one entry");
  }
  let best = entries[0];
  for (const e of entries.slice(1)) {
    if (e.officialDate > best.officialDate) {
      best = e;
    } else if (e.officialDate === best.officialDate && e.gameDate > best.gameDate) {
      best = e;
    }
  }
  return best;
}

/** Collapses duplicates by providerGameId using pickScheduleEntry. */
export function dedupeSchedule(entries: readonly ProviderGame[]): ProviderGame[] {
  const byId = new Map<string, ProviderGame[]>();
  for (const e of entries) {
    const list = byId.get(e.providerGameId);
    if (list) list.push(e);
    else byId.set(e.providerGameId, [e]);
  }
  return [...byId.values()].map(pickScheduleEntry);
}

/** YYYY-MM-DD for `now` in a time zone. MLB's game day follows America/New_York. */
export function localDate(now: Date, timeZone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM-DD plus a number of days (calendar arithmetic, no time zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
