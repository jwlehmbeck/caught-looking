import { describe, expect, it } from "vitest";

import { contentTypeFor, detectVideo } from "@shared/scan/magic-bytes.ts";

function header(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 0x18]);
  bytes.set(Array.from("ftyp", (c) => c.charCodeAt(0)), 4);
  bytes.set(Array.from(brand, (c) => c.charCodeAt(0)), 8);
  return bytes;
}

describe("magic bytes", () => {
  it("accepts MP4 brands", () => {
    for (const brand of ["isom", "iso2", "mp41", "mp42", "avc1"]) {
      expect(detectVideo(header(brand))).toMatchObject({ ok: true, kind: "mp4", brand });
    }
    expect(contentTypeFor("mp4")).toBe("video/mp4");
  });

  it("accepts QuickTime", () => {
    expect(detectVideo(header("qt  "))).toMatchObject({ ok: true, kind: "mov" });
    expect(contentTypeFor("mov")).toBe("video/quicktime");
  });

  it("rejects an HTML file renamed to .mp4", () => {
    const html = new TextEncoder().encode("<!doctype html><html>");
    expect(detectVideo(html)).toMatchObject({ ok: false, reason: "no_ftyp" });
  });

  it("rejects unknown brands and short files", () => {
    expect(detectVideo(header("3gp4"))).toMatchObject({ ok: false, reason: "unknown_brand" });
    expect(detectVideo(new Uint8Array(4))).toMatchObject({ ok: false, reason: "too_short" });
  });
});
