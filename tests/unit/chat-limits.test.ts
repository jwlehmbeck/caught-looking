import { describe, expect, it } from "vitest";

import {
  accountUnlocksAt,
  appendMessage,
  bodyProblem,
  chatWindowState,
  removeMessage,
  slowModeRemainingSeconds,
  visibleMessages,
} from "@/lib/chat/rules";

const NOW = Date.parse("2026-10-21T22:00:00Z");
const min = (n: number) => n * 60_000;

describe("chatWindowState", () => {
  it("is pre_lock before the lock time of an open game", () => {
    expect(chatWindowState({ appState: "open", lockAt: new Date(NOW + min(5)).toISOString(), endedAt: null }, NOW)).toBe("pre_lock");
  });

  it("opens once the lock time passes even before the poller flips the state", () => {
    expect(chatWindowState({ appState: "open", lockAt: new Date(NOW - min(1)).toISOString(), endedAt: null }, NOW)).toBe("open");
  });

  it("is open while locked, live or suspended", () => {
    for (const appState of ["locked", "live", "suspended"] as const) {
      expect(chatWindowState({ appState, lockAt: new Date(NOW - min(60)).toISOString(), endedAt: null }, NOW)).toBe("open");
    }
  });

  it("stays open for 30 minutes after the final, then goes read-only", () => {
    const lockAt = new Date(NOW - min(240)).toISOString();
    expect(chatWindowState({ appState: "final", lockAt, endedAt: new Date(NOW - min(29)).toISOString() }, NOW)).toBe("open");
    expect(chatWindowState({ appState: "scored", lockAt, endedAt: new Date(NOW - min(31)).toISOString() }, NOW)).toBe("read_only");
  });

  it("is read-only when staff closed it or the game is void", () => {
    const lockAt = new Date(NOW - min(60)).toISOString();
    expect(chatWindowState({ appState: "live", lockAt, endedAt: null, closed: true }, NOW)).toBe("read_only");
    expect(chatWindowState({ appState: "void", lockAt, endedAt: null }, NOW)).toBe("read_only");
  });
});

describe("slowModeRemainingSeconds", () => {
  it("is 0 with no previous message", () => {
    expect(slowModeRemainingSeconds(null, NOW)).toBe(0);
  });

  it("counts down from the slow-mode length and rounds up", () => {
    expect(slowModeRemainingSeconds(NOW - 2_500, NOW)).toBe(8);
    expect(slowModeRemainingSeconds(NOW - 9_999, NOW)).toBe(1);
    expect(slowModeRemainingSeconds(NOW - 10_000, NOW)).toBe(0);
  });

  it("honours a longer slow mode set by a mod", () => {
    expect(slowModeRemainingSeconds(NOW - 20_000, NOW, 60)).toBe(40);
  });
});

describe("accountUnlocksAt", () => {
  it("gates accounts younger than 24 hours", () => {
    const created = NOW - 2 * 3_600_000;
    expect(accountUnlocksAt(created, NOW)).toBe(created + 24 * 3_600_000);
    expect(accountUnlocksAt(new Date(created).toISOString(), NOW)).toBe(created + 24 * 3_600_000);
  });

  it("is null for accounts at least 24 hours old", () => {
    expect(accountUnlocksAt(NOW - 24 * 3_600_000, NOW)).toBeNull();
    expect(accountUnlocksAt(NOW - 72 * 3_600_000, NOW)).toBeNull();
  });
});

describe("bodyProblem", () => {
  it("rejects empty and whitespace-only bodies", () => {
    expect(bodyProblem("")).toBe("empty");
    expect(bodyProblem("   ")).toBe("empty");
  });

  it("allows 200 code points and rejects 201", () => {
    expect(bodyProblem("x".repeat(200))).toBeNull();
    expect(bodyProblem("x".repeat(201))).toBe("too_long");
    expect(bodyProblem("🙂".repeat(200))).toBeNull();
  });
});

describe("visibleMessages", () => {
  const msgs = [
    { id: 1, authorId: "a", status: "live" },
    { id: 2, authorId: "b", status: "live" },
    { id: 3, authorId: "a", status: "hidden" },
    { id: 4, authorId: null, status: "live" },
  ];

  it("drops blocked authors and non-live messages, keeps anonymised ones", () => {
    expect(visibleMessages(msgs, ["b"]).map((m) => m.id)).toEqual([1, 4]);
    expect(visibleMessages(msgs, new Set<string>()).map((m) => m.id)).toEqual([1, 2, 4]);
  });

  it("appends without duplicates and removes by id", () => {
    const list = appendMessage(msgs, { id: 2, authorId: "b", status: "live" });
    expect(list).toHaveLength(4);
    expect(appendMessage(list, { id: 5, authorId: "c", status: "live" })).toHaveLength(5);
    expect(removeMessage(list, 1).map((m) => m.id)).toEqual([2, 3, 4]);
  });
});
