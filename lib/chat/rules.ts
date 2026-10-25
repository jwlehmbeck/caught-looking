/**
 * Live chat rules (plan U9), pure and shared by the UI and the Vitest suite.
 * The database enforces the same rules on every send; this module only
 * decides what the screen shows and when the send button can be tapped.
 */

import type { AppState } from "@shared/domain/game-state.ts";

export const CHAT_MAX_CHARS = 200;
export const CHAT_DEFAULT_SLOW_MODE_SECONDS = 10;
export const CHAT_ACCOUNT_AGE_HOURS = 24;
/** Minutes after the final during which the room stays open. */
export const CHAT_CLOSE_AFTER_FINAL_MINUTES = 30;
export const SLOW_MODE_CHOICES = [10, 30, 60] as const;

export type ChatWindowState = "pre_lock" | "open" | "read_only";

export interface ChatGameInput {
  appState: AppState;
  /** ISO timestamp. */
  lockAt: string;
  /** ISO timestamp of the final, when there is one. */
  endedAt: string | null;
  /** Staff switched the room off. */
  closed?: boolean;
}

/** Open, not yet open, or closed for good, from the game state alone. */
export function chatWindowState(game: ChatGameInput, now: number): ChatWindowState {
  const locked = game.appState !== "open" || now >= new Date(game.lockAt).getTime();
  if (!locked) return "pre_lock";
  if (game.closed) return "read_only";
  switch (game.appState) {
    case "open":
    case "locked":
    case "live":
    case "suspended":
      return "open";
    case "final":
    case "scored": {
      if (!game.endedAt) return "read_only";
      const closesAt = new Date(game.endedAt).getTime() + CHAT_CLOSE_AFTER_FINAL_MINUTES * 60_000;
      return now < closesAt ? "open" : "read_only";
    }
    case "void":
      return "read_only";
  }
}

/** Whole seconds a member still has to wait before the next send (0 when free). */
export function slowModeRemainingSeconds(
  lastSentAt: number | null,
  now: number,
  slowModeSeconds: number = CHAT_DEFAULT_SLOW_MODE_SECONDS,
): number {
  if (lastSentAt === null) return 0;
  const readyAt = lastSentAt + slowModeSeconds * 1000;
  if (now >= readyAt) return 0;
  return Math.ceil((readyAt - now) / 1000);
}

/** Null when the account is old enough; otherwise the epoch ms when it unlocks. */
export function accountUnlocksAt(accountCreatedAt: string | number, now: number): number | null {
  const created = typeof accountCreatedAt === "number" ? accountCreatedAt : new Date(accountCreatedAt).getTime();
  const unlocksAt = created + CHAT_ACCOUNT_AGE_HOURS * 3_600_000;
  return now >= unlocksAt ? null : unlocksAt;
}

export type BodyProblem = "empty" | "too_long" | null;

/** Counted in code points, like the database constraint. */
export function bodyLength(body: string): number {
  return Array.from(body.trim()).length;
}

export function bodyProblem(body: string): BodyProblem {
  const n = bodyLength(body);
  if (n === 0) return "empty";
  if (n > CHAT_MAX_CHARS) return "too_long";
  return null;
}

export interface ChatMessageLike {
  id: number;
  authorId: string | null;
  status?: string;
}

/**
 * Which messages a viewer sees: live ones whose author the viewer has not
 * blocked. Used for the history and for every live broadcast, since
 * broadcasts cannot be filtered per viewer on the server.
 */
export function visibleMessages<T extends ChatMessageLike>(
  messages: readonly T[],
  blockedIds: ReadonlySet<string> | readonly string[],
): T[] {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds);
  return messages.filter(
    (m) => (m.status === undefined || m.status === "live") && (m.authorId === null || !blocked.has(m.authorId)),
  );
}

/** Appends a live message, ignoring duplicates (reconnects can replay). */
export function appendMessage<T extends ChatMessageLike>(list: readonly T[], next: T): T[] {
  if (list.some((m) => m.id === next.id)) return [...list];
  return [...list, next];
}

export function removeMessage<T extends ChatMessageLike>(list: readonly T[], id: number): T[] {
  return list.filter((m) => m.id !== id);
}
