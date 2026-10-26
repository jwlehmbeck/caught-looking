import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, REJECTION_COPY, validateUploadMeta } from "@shared/scan/upload-rules.ts";

describe("validateUploadMeta", () => {
  it("accepts a 45 second MP4 under the size cap", () => {
    expect(validateUploadMeta({ durationSeconds: 45, sizeBytes: 20_000_000, mime: "video/mp4" })).toEqual({ ok: true, extension: "mp4" });
  });

  it("accepts a MOV and maps it to the mov extension", () => {
    expect(validateUploadMeta({ durationSeconds: 60, sizeBytes: 1, mime: "video/quicktime" })).toEqual({ ok: true, extension: "mov" });
  });

  it("rejects 61 seconds", () => {
    expect(validateUploadMeta({ durationSeconds: 61, sizeBytes: 1_000, mime: "video/mp4" })).toMatchObject({ ok: false, reason: "too_long" });
    expect(validateUploadMeta({ durationSeconds: 75, sizeBytes: 1_000, mime: "video/mp4" })).toMatchObject({ ok: false, reason: "too_long" });
  });

  it("rejects files over 150 MB", () => {
    expect(validateUploadMeta({ durationSeconds: 10, sizeBytes: MAX_UPLOAD_BYTES + 1, mime: "video/mp4" })).toMatchObject({ ok: false, reason: "too_big" });
    expect(validateUploadMeta({ durationSeconds: 10, sizeBytes: MAX_UPLOAD_BYTES, mime: "video/mp4" }).ok).toBe(true);
  });

  it("rejects other types and empty or unreadable files", () => {
    expect(validateUploadMeta({ durationSeconds: 10, sizeBytes: 100, mime: "text/html" })).toMatchObject({ ok: false, reason: "bad_type" });
    expect(validateUploadMeta({ durationSeconds: 10, sizeBytes: 100, mime: "video/webm" })).toMatchObject({ ok: false, reason: "bad_type" });
    expect(validateUploadMeta({ durationSeconds: 10, sizeBytes: 0, mime: "video/mp4" })).toMatchObject({ ok: false, reason: "empty" });
    expect(validateUploadMeta({ durationSeconds: Number.NaN, sizeBytes: 10, mime: "video/mp4" })).toMatchObject({ ok: false, reason: "bad_duration" });
  });

  it("has plain-words copy for every rejection reason", () => {
    for (const reason of ["copyright", "personal_info", "contact_info", "off_topic", "quality", "unsafe"] as const) {
      expect(REJECTION_COPY[reason].length).toBeGreaterThan(10);
    }
  });
});
