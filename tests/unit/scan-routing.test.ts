import { describe, expect, it } from "vitest";

import { routeScan, type ScanInput } from "@shared/scan/routing.ts";

const clean: ScanInput = { csam: { checked: true, match: false }, labels: [], durationMs: 45_000, magicOk: true, sizeOk: true };

describe("routeScan", () => {
  it("queues a clean 45 second clip for admin approval", () => {
    expect(routeScan(clean)).toEqual({ outcome: "queue" });
  });

  it("quarantines a CSAM match before anything else", () => {
    expect(routeScan({ ...clean, csam: { checked: true, match: true }, magicOk: false, durationMs: 90_000 })).toEqual({ outcome: "quarantine" });
  });

  it("rejects explicit labels at 80 or more confidence and alerts", () => {
    const route = routeScan({ ...clean, labels: [{ Name: "Exposed Male Genitalia", ParentName: "Explicit Nudity", Confidence: 91 }] });
    expect(route.outcome).toBe("reject");
    expect(route.reason).toBe("unsafe");
    expect(route.matchedLabels).toHaveLength(1);
  });

  it("matches on the name when the parent is missing", () => {
    expect(routeScan({ ...clean, labels: [{ Name: "Sexual Activity", Confidence: 85 }] }).outcome).toBe("reject");
    expect(routeScan({ ...clean, labels: [{ Name: "Partial Nudity", Confidence: 80 }] }).outcome).toBe("reject");
  });

  it("queues explicit labels under 80 confidence", () => {
    expect(routeScan({ ...clean, labels: [{ Name: "Explicit Nudity", ParentName: "Explicit Nudity", Confidence: 79.9 }] })).toEqual({ outcome: "queue" });
  });

  it("ignores unrelated labels", () => {
    expect(routeScan({ ...clean, labels: [{ Name: "Alcohol", ParentName: "Alcohol", Confidence: 99 }] })).toEqual({ outcome: "queue" });
  });

  it("rejects a clip over 60 seconds", () => {
    expect(routeScan({ ...clean, durationMs: 60_001 })).toEqual({ outcome: "reject", reason: "quality" });
    expect(routeScan({ ...clean, durationMs: 60_000 })).toEqual({ outcome: "queue" });
  });

  it("rejects bad magic bytes and oversize files", () => {
    expect(routeScan({ ...clean, magicOk: false })).toEqual({ outcome: "reject", reason: "quality" });
    expect(routeScan({ ...clean, sizeOk: false })).toEqual({ outcome: "reject", reason: "quality" });
  });

  it("queues as unscanned when the scan timed out", () => {
    expect(routeScan({ ...clean, labels: null, durationMs: null, timedOut: true })).toEqual({ outcome: "queue_unscanned", reason: "timeout" });
  });

  it("an unchecked CSAM result never quarantines", () => {
    expect(routeScan({ ...clean, csam: { checked: false, match: true } })).toEqual({ outcome: "queue" });
  });
});
