import { describe, expect, it } from "vitest";

import { canonicalizeShareUrl, linkDestination } from "@shared/domain/links.ts";

describe("canonicalizeShareUrl", () => {
  it("accepts MLB.com video pages and canonicalizes to www", () => {
    expect(canonicalizeShareUrl("https://www.mlb.com/video/walk-off-c123")).toEqual({
      ok: true,
      url: "https://www.mlb.com/video/walk-off-c123",
      kind: "mlb",
    });
    expect(canonicalizeShareUrl("https://mlb.com/dodgers/video/x/")).toEqual({
      ok: true,
      url: "https://www.mlb.com/dodgers/video/x",
      kind: "mlb",
    });
  });

  it("strips tracking parameters and fragments", () => {
    expect(canonicalizeShareUrl("https://www.mlb.com/video/abc?utm_source=share&partnerId=x#t=12")).toEqual({
      ok: true,
      url: "https://www.mlb.com/video/abc",
      kind: "mlb",
    });
    expect(canonicalizeShareUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&t=10s")).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      kind: "youtube",
    });
  });

  it("rejects look-alike hosts", () => {
    expect(canonicalizeShareUrl("https://mlb.com.evil.example/video/x")).toEqual({ ok: false, reason: "host" });
    expect(canonicalizeShareUrl("https://user@mlb.com.evil.example/")).toMatchObject({ ok: false });
    expect(canonicalizeShareUrl("https://notmlb.com/video/x")).toEqual({ ok: false, reason: "host" });
    expect(canonicalizeShareUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toEqual({ ok: false, reason: "host" });
  });

  it("rejects http, userinfo, ports and the bare MLB.com home page", () => {
    expect(canonicalizeShareUrl("http://www.mlb.com/video/x")).toEqual({ ok: false, reason: "scheme" });
    expect(canonicalizeShareUrl("https://me@www.mlb.com/video/x")).toEqual({ ok: false, reason: "userinfo" });
    expect(canonicalizeShareUrl("https://www.mlb.com:8443/video/x")).toEqual({ ok: false, reason: "port" });
    expect(canonicalizeShareUrl("https://www.mlb.com/")).toEqual({ ok: false, reason: "path" });
    expect(canonicalizeShareUrl("nonsense")).toEqual({ ok: false, reason: "invalid" });
  });

  it("requires an 11-character YouTube video id", () => {
    expect(canonicalizeShareUrl("https://www.youtube.com/watch?v=short")).toEqual({ ok: false, reason: "youtube_id" });
    expect(canonicalizeShareUrl("https://www.youtube.com/@MLB")).toEqual({ ok: false, reason: "youtube_id" });
    expect(canonicalizeShareUrl("https://www.youtube.com/results?search_query=mlb")).toEqual({ ok: false, reason: "youtube_id" });
    expect(canonicalizeShareUrl("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      kind: "youtube",
    });
    expect(canonicalizeShareUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ ok: true, kind: "youtube" });
  });
});

describe("linkDestination", () => {
  it("names the site a stored link opens", () => {
    expect(linkDestination("https://www.mlb.com/video/x")).toBe("MLB.com");
    expect(linkDestination("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YouTube");
    expect(linkDestination("https://example.com/")).toBeNull();
    expect(linkDestination(null)).toBeNull();
  });
});
