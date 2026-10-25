/**
 * Text normalization for the content filter (plan U12).
 *
 * Folds case, Unicode compatibility forms, zero-width characters, common
 * Cyrillic/Greek lookalikes and leetspeak into plain lowercase Latin so the
 * wordlists only need the plain spelling of each word.
 *
 * Runtime-neutral: no Node, Next or Deno APIs.
 */

export interface NormalizedText {
  /** Lowercase, folded text with punctuation turned into single spaces. */
  folded: string;
  /** Alphanumeric tokens of `folded`, in order. */
  tokens: string[];
  /** All tokens joined with nothing between them. Catches "s h i t". */
  compact: string;
  /** `compact` with every run of the same letter squeezed to one. */
  squeezed: string;
}

// Lookalike characters → Latin. Covers the Cyrillic and Greek letters that
// render like Latin ones plus a few fullwidth/enclosed forms NFKC misses.
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: "a", ә: "a", е: "e", ё: "e", є: "e", ө: "o", о: "o", р: "p", с: "c",
  у: "y", ү: "y", х: "x", і: "i", ї: "i", ј: "j", ѕ: "s", һ: "h", к: "k",
  м: "m", т: "t", в: "b", н: "h", п: "n", г: "r", ь: "b",
  ԁ: "d", ԛ: "q", ԝ: "w", ғ: "f", ҫ: "c", ѵ: "v", ш: "w",
  // Greek
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p",
  τ: "t", υ: "u", χ: "x", ω: "w", μ: "u", ς: "s", γ: "y", ζ: "z",
  // Latin letters with marks that NFKC does not strip
  ø: "o", ł: "l", đ: "d", ı: "i", ß: "ss", æ: "ae", œ: "oe", þ: "th",
};

// Leetspeak and symbol substitutions.
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "€": "e",
  "£": "l",
  "+": "t",
  "¡": "i",
};

const ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff\u00ad]/g;
const COMBINING = /[\u0300-\u036f]/g;

/** Lowercase, NFKC, strip zero-width and combining marks, fold lookalikes. */
export function foldCharacters(input: string): string {
  const base = input
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "");
  let out = "";
  for (const ch of base) {
    out += LOOKALIKES[ch] ?? ch;
  }
  return out;
}

/** Apply leetspeak folds (0→o, 3→e, @→a …). */
export function foldLeet(input: string): string {
  let out = "";
  for (const ch of input) {
    out += LEET[ch] ?? ch;
  }
  return out;
}

/** Collapse runs of the same character longer than `max` down to `max`. */
export function collapseRepeats(input: string, max = 2): string {
  let out = "";
  let last = "";
  let run = 0;
  for (const ch of input) {
    if (ch === last) {
      run += 1;
    } else {
      last = ch;
      run = 1;
    }
    if (run <= max) out += ch;
  }
  return out;
}

/** Squeeze every run of the same character to a single one. */
export function squeeze(input: string): string {
  return collapseRepeats(input, 1);
}

/**
 * Full normalization. `keepDigits` leaves digits alone (used for the
 * contact-info pass, which needs real phone digits).
 */
export function normalizeText(input: string, opts: { keepDigits?: boolean } = {}): NormalizedText {
  let folded = foldCharacters(input);
  if (!opts.keepDigits) folded = foldLeet(folded);
  folded = folded.replace(/[^a-z0-9]+/g, " ").trim();
  folded = collapseRepeats(folded, 2);
  const tokens = folded.length ? folded.split(" ") : [];
  const compact = tokens.join("");
  return { folded, tokens, compact, squeezed: squeeze(compact) };
}
