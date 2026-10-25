import { describe, expect, it } from "vitest";

import { validateUsername } from "@shared/filters/username.ts";

// The reserved set the database ships with, in miniature.
const reserved = new Set(["mlb", "mlb_official", "dodgers", "yankees", "ohtani", "admin", "mod"]);
const held = new Set(["oldtimer"]);
const options = { reserved, held };

describe("username rules (plan U3)", () => {
  it.each(["MLB_Official", "Adm1n", "snap_jake22", "EmmaJ2011"])("rejects %s", (name) => {
    expect(validateUsername(name, options).ok).toBe(false);
  });

  it.each(["slidestep", "nasty_curve"])("accepts %s", (name) => {
    expect(validateUsername(name, options).ok).toBe(true);
  });

  it("rejects bad formats", () => {
    expect(validateUsername("ab", options).reason).toBe("format");
    expect(validateUsername("a".repeat(21), options).reason).toBe("format");
    expect(validateUsername("hello world", options).reason).toBe("format");
    expect(validateUsername("hi-there", options).reason).toBe("format");
  });

  it("rejects held names", () => {
    expect(validateUsername("OldTimer", options).reason).toBe("held");
  });

  it("folds leetspeak so lookalikes collide on the normalized form", () => {
    expect(validateUsername("Adm1n", options).normalized).toBe("admin");
    expect(validateUsername("Adm1n", options).reason).toBe("reserved");
  });

  it("rejects contact handles", () => {
    expect(validateUsername("snap_jake22", options).reason).toBe("contact");
  });

  it("rejects a real-looking name with a birth year", () => {
    expect(validateUsername("EmmaJ2011", options).reason).toBe("real_name");
  });
});
