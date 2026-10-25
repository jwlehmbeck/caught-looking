/**
 * Username rules (plan U3/U12): 3–20 characters of letters, digits and
 * underscores; the normalized form must not be reserved, held, a bad word,
 * contact information, or shaped like a real name plus a birth year.
 *
 * `normalized` is what goes into profiles.normalized_username: lowercase,
 * with leetspeak digits folded so "Adm1n" and "admin" collide.
 */
import { findContactInfo } from "./contact.ts";
import { foldLeet } from "./normalize.ts";
import { findBadWord } from "./pipeline.ts";

export type UsernameReason =
  | "format"
  | "reserved"
  | "held"
  | "profanity"
  | "contact"
  | "real_name";

export interface UsernameCheck {
  ok: boolean;
  normalized: string;
  reason?: UsernameReason;
}

export interface UsernameOptions {
  /** Normalized reserved names (MLB, clubs, players, staff words). */
  reserved: ReadonlySet<string>;
  /** Normalized usernames held after account deletion. */
  held: ReadonlySet<string>;
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Staff-sounding words nobody may use in a name, whatever the database says. */
const STAFF_WORDS: readonly string[] = [
  "admin",
  "administrator",
  "moderator",
  "mod",
  "staff",
  "official",
  "support",
  "mlb",
  "caughtlooking",
  "system",
  "root",
];

/** Lowercase with leetspeak digits folded to letters. Only [a-z0-9_] remain. */
export function normalizeUsername(raw: string): string {
  const folded = foldLeet(raw.toLowerCase()).replace(/[^a-z0-9_]/g, "");
  return folded;
}

function isRealNameWithYear(lower: string): boolean {
  const m = /^([a-z]+(?:_?[a-z]+)*)_?((?:19|20)\d\d)$/.exec(lower);
  if (!m) return false;
  const letters = m[1].replace(/_/g, "");
  const year = Number(m[2]);
  return letters.length >= 3 && year >= 1990 && year <= 2016;
}

export function validateUsername(raw: string, options: UsernameOptions): UsernameCheck {
  const normalized = USERNAME_RE.test(raw) ? normalizeUsername(raw) : "";
  const fail = (reason: UsernameReason): UsernameCheck => ({ ok: false, normalized, reason });

  if (!USERNAME_RE.test(raw) || normalized.length < 3) return fail("format");

  const lower = raw.toLowerCase();
  const parts = new Set(
    [normalized, lower]
      .flatMap((s) => s.split(/[_\d]+/))
      .filter((p) => p.length > 0),
  );
  parts.add(normalized);
  parts.add(lower);
  parts.add(normalized.replace(/_/g, ""));

  for (const p of parts) {
    if (options.reserved.has(p) || STAFF_WORDS.includes(p)) return fail("reserved");
  }
  const squashed = normalized.replace(/[_\d]/g, "");
  for (const w of STAFF_WORDS) {
    if (w.length >= 4 && squashed.includes(w)) return fail("reserved");
  }

  if (options.held.has(normalized) || options.held.has(lower)) return fail("held");

  if (findBadWord(raw, { joinTokens: true }) !== null) return fail("profanity");

  if (findContactInfo(raw.replace(/_/g, " ")).length > 0) return fail("contact");
  if (findContactInfo(raw).length > 0) return fail("contact");

  if (isRealNameWithYear(lower)) return fail("real_name");

  return { ok: true, normalized };
}
