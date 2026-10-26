/**
 * CSAM hash matching (plan U11, Key Technical Decisions).
 *
 * The real matcher is a vetted service: Thorn's Safer or Google's CSAI Match
 * (video) / NCMEC hash lists through a licensed provider. Those programs
 * require an application and an agreement, so this module defines the
 * interface and ships a `disabled` implementation that reports
 * `{ checked: false }`. scan-upload treats an unchecked upload like any
 * other scan result: it still goes to the admin queue, never straight live.
 *
 * Plugging a provider in: implement `CsamMatcher.hashMatchFrames` (frames
 * are JPEG bytes sampled from the video, or the provider's own video-hash
 * input), construct it in `csamMatcherFromEnv` when CSAM_SERVICE_URL and
 * CSAM_SERVICE_KEY are set, and follow docs/policies/csam-procedure.md for
 * the human side. A match routes to quarantine before anything else.
 */
import { readEnv } from "../alerts/index.ts";

export interface CsamMatchResult {
  /** False when no matcher ran; the upload is then "unchecked", not "clean". */
  checked: boolean;
  match: boolean;
  provider?: string;
  /** Provider reference for the report; never the content itself. */
  reference?: string;
}

export interface CsamMatcher {
  readonly name: string;
  hashMatchFrames(frames: Uint8Array[]): Promise<CsamMatchResult>;
}

export const disabledCsamMatcher: CsamMatcher = {
  name: "disabled",
  hashMatchFrames: () => Promise.resolve({ checked: false, match: false, provider: "disabled" }),
};

/**
 * Generic HTTPS matcher: POSTs the frames as a multipart body to the
 * configured service and expects `{ "match": boolean, "reference"?: string }`.
 * Adapt the request shape to the provider's API when wiring one in.
 */
export function httpCsamMatcher(url: string, key: string, doFetch: typeof fetch = fetch): CsamMatcher {
  return {
    name: "http",
    async hashMatchFrames(frames) {
      if (frames.length === 0) return { checked: false, match: false, provider: "http" };
      const form = new FormData();
      frames.forEach((f, i) => form.append("frames", new Blob([f as BlobPart], { type: "image/jpeg" }), `frame-${i}.jpg`));
      const res = await doFetch(url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
      if (!res.ok) return { checked: false, match: false, provider: "http" };
      const json = (await res.json()) as { match?: boolean; reference?: string };
      return { checked: true, match: json.match === true, provider: "http", reference: json.reference };
    },
  };
}

export function csamMatcherFromEnv(): CsamMatcher {
  const url = readEnv("CSAM_SERVICE_URL");
  const key = readEnv("CSAM_SERVICE_KEY");
  if (!url || !key) return disabledCsamMatcher;
  return httpCsamMatcher(url, key);
}
