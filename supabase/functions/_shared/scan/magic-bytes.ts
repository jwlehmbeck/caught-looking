/**
 * File-type detection from the first bytes of an upload (plan U11).
 *
 * ISO base media files (MP4, MOV) start with a box whose type at offset 4 is
 * `ftyp` and whose major brand follows at offset 8. Anything else, including
 * an HTML page renamed to .mp4, is rejected. Pure: no I/O.
 */

export type VideoKind = "mp4" | "mov";

export interface MagicResult {
  ok: boolean;
  kind: VideoKind | null;
  brand: string | null;
  reason?: "too_short" | "no_ftyp" | "unknown_brand";
}

const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "mmp4", "m4v ", "M4V ", "dash"]);
const MOV_BRANDS = new Set(["qt  "]);

/** Reads the first 16 bytes of a file and says whether it is an MP4 or MOV. */
export function detectVideo(bytes: Uint8Array): MagicResult {
  if (bytes.length < 12) return { ok: false, kind: null, brand: null, reason: "too_short" };
  const ftyp = ascii(bytes, 4, 8);
  if (ftyp !== "ftyp") return { ok: false, kind: null, brand: null, reason: "no_ftyp" };
  const brand = ascii(bytes, 8, 12);
  if (MP4_BRANDS.has(brand)) return { ok: true, kind: "mp4", brand };
  if (MOV_BRANDS.has(brand)) return { ok: true, kind: "mov", brand };
  return { ok: false, kind: null, brand, reason: "unknown_brand" };
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

/** The content type we store and serve for a detected kind. */
export function contentTypeFor(kind: VideoKind): string {
  return kind === "mov" ? "video/quicktime" : "video/mp4";
}
