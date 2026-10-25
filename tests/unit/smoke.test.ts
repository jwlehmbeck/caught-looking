import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/supabase/proxy";
import { SHARED_VERSION } from "@shared/version.ts";

describe("test harness", () => {
  it("imports shared code through the @shared alias", () => {
    expect(SHARED_VERSION).toBe("0.1.0");
  });
});

describe("isPublicPath", () => {
  it("lets signed-out visitors reach signup and policy pages", () => {
    for (const p of ["/signup", "/login", "/recover", "/rules", "/terms/", "/child-safety"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("treats app routes as private", () => {
    for (const p of ["/", "/game/123", "/leaderboard", "/signupx", "/mod"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
