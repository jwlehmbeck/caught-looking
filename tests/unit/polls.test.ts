import { describe, expect, it } from "vitest";

import {
  closesAtFor,
  closesInLabel,
  isClosed,
  percentages,
  resultsVisible,
  validatePollInput,
} from "@/lib/polls/rules";

const now = new Date("2026-10-25T18:00:00Z");

describe("results visibility", () => {
  it("hides results from a viewer who has not voted while the poll is open", () => {
    expect(resultsVisible({ status: "open", closesAt: "2026-10-26T18:00:00Z", myOptionId: null }, now)).toBe(false);
  });
  it("shows results after the viewer voted", () => {
    expect(resultsVisible({ status: "open", closesAt: "2026-10-26T18:00:00Z", myOptionId: 7 }, now)).toBe(true);
  });
  it("shows results after close, by status or by clock", () => {
    expect(resultsVisible({ status: "closed", closesAt: "2026-10-26T18:00:00Z", myOptionId: null }, now)).toBe(true);
    expect(resultsVisible({ status: "open", closesAt: "2026-10-25T17:59:00Z", myOptionId: null }, now)).toBe(true);
  });
  it("treats an unparsable close time as closed", () => {
    expect(isClosed({ status: "open", closesAt: "nope" }, now)).toBe(true);
  });
});

describe("closes-in label", () => {
  it("formats minutes, hours and days", () => {
    expect(closesInLabel({ status: "open", closesAt: "2026-10-25T18:20:00Z" }, now)).toBe("Closes in 20m");
    expect(closesInLabel({ status: "open", closesAt: "2026-10-25T20:05:00Z" }, now)).toBe("Closes in 2h 05m");
    expect(closesInLabel({ status: "open", closesAt: "2026-10-28T18:00:00Z" }, now)).toBe("Closes in 3d");
    expect(closesInLabel({ status: "open", closesAt: "2026-10-27T20:00:00Z" }, now)).toBe("Closes in 2d 2h");
  });
  it("says Closed once closed", () => {
    expect(closesInLabel({ status: "closed", closesAt: "2026-10-28T18:00:00Z" }, now)).toBe("Closed");
    expect(closesInLabel({ status: "open", closesAt: "2026-10-25T18:00:00Z" }, now)).toBe("Closed");
  });
  it("maps the close choices to future times", () => {
    expect(closesAtFor("1h", now)?.toISOString()).toBe("2026-10-25T19:00:00.000Z");
    expect(closesAtFor("3d", now)?.toISOString()).toBe("2026-10-28T18:00:00.000Z");
    expect(closesAtFor("1w", now)).toBeNull();
  });
});

describe("percentages", () => {
  it("sum to 100 and handle zero", () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([3, 1])).toEqual([75, 25]);
  });
});

describe("option validation", () => {
  it("accepts 2 to 4 trimmed options", () => {
    const r = validatePollInput("  Better rivalry? ", ["Yanks–Sox", " Dodgers–Giants ", "", ""]);
    expect(r).toEqual({ ok: true, question: "Better rivalry?", options: ["Yanks–Sox", "Dodgers–Giants"] });
  });
  it("rejects fewer than 2 or more than 4 options", () => {
    expect(validatePollInput("Q", ["only"]).ok).toBe(false);
    expect(validatePollInput("Q", ["a", "b", "c", "d", "e"]).ok).toBe(false);
  });
  it("rejects long questions and options, and duplicates", () => {
    expect(validatePollInput("x".repeat(201), ["a", "b"]).ok).toBe(false);
    expect(validatePollInput("Q", ["a".repeat(81), "b"]).ok).toBe(false);
    expect(validatePollInput("Q", ["Same", "same"]).ok).toBe(false);
    expect(validatePollInput("", ["a", "b"]).ok).toBe(false);
  });
});
