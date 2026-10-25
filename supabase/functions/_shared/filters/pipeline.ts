/**
 * The one content-filter pipeline for all text (plan U12, Key Technical
 * Decisions). Used for usernames, chat, post titles, comments and poll text.
 *
 * Order: length → normalize → allow-list → bad words → contact info → URL
 * rule → moderation API. It fails closed: when the moderation call errors or
 * times out, chat/comments/titles/polls come back `flag` (the caller holds
 * the message) and usernames come back `reject`.
 *
 * User messages are deliberately neutral so nobody can probe the rules.
 */
import { findContactInfo, type ContactMatch } from "./contact.ts";
import { type ModerateFn } from "./moderation.ts";
import { normalizeText, squeeze } from "./normalize.ts";
import { checkUrl } from "./url.ts";
import { ALLOW } from "./wordlist/allow.ts";
import { PROFANITY } from "./wordlist/profanity.ts";
import { SLURS } from "./wordlist/slurs.ts";

export type FilterContext = "username" | "chat" | "comment" | "title" | "poll";

export type FilterReason =
  | "profanity"
  | "contact_info"
  | "url"
  | "reserved"
  | "moderation"
  | "too_long";

export interface FilterOptions {
  context: FilterContext;
  /** Hostnames whose links may appear (posts). Absent means no links at all. */
  allowUrls?: readonly string[];
  /** Moderation call. Absent means local checks only (tests, offline paths). */
  moderate?: ModerateFn;
}

export interface FilterResult {
  verdict: "allow" | "reject" | "flag";
  reason?: FilterReason;
  userMessage: string;
  /** Moderation categories when the API flagged the text. */
  categories?: string[];
  /** Links that passed the allow-list, in the order found. */
  urls?: string[];
}

export const MAX_LENGTH: Record<FilterContext, number> = {
  username: 20,
  chat: 200,
  comment: 500,
  title: 140,
  poll: 200,
};

const MESSAGE_POST = "That message can't be posted.";
const MESSAGE_USERNAME = "That username isn't available.";
const MESSAGE_HELD = "Hang on, that message is being checked.";

function userMessage(context: FilterContext, verdict: FilterResult["verdict"]): string {
  if (context === "username") return MESSAGE_USERNAME;
  return verdict === "flag" ? MESSAGE_HELD : MESSAGE_POST;
}

// Wordlists in their normalized forms, built once.
const BAD_WORDS: readonly string[] = Array.from(
  new Set([...SLURS, ...PROFANITY].map((w) => normalizeText(w).compact).filter(Boolean)),
);
const LONG_BAD_WORDS = BAD_WORDS.filter((w) => w.length >= 4);
const SQUEEZED_BAD_WORDS = Array.from(
  new Set(LONG_BAD_WORDS.map(squeeze).filter((w) => w.length >= 4)),
);
const ALLOW_SET = new Set(ALLOW.map((w) => normalizeText(w).compact));
const BAD_SET = new Set(BAD_WORDS);

/** Tokens of 1–2 characters in a row, joined: catches "s h i t". */
function spelledOutRuns(tokens: string[]): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  for (const t of tokens) {
    if (t.length <= 2) {
      current.push(t);
    } else {
      if (current.length >= 2) runs.push(current.join(""));
      current = [];
    }
  }
  if (current.length >= 2) runs.push(current.join(""));
  return runs;
}

/**
 * Returns the bad word found in `text`, or null. `joinTokens` also scans the
 * whole text with separators removed; only usernames want that, because in
 * a sentence "this hit" would read as one word.
 */
export function findBadWord(text: string, opts: { joinTokens?: boolean } = {}): string | null {
  const norm = normalizeText(text);

  for (const token of norm.tokens) {
    if (ALLOW_SET.has(token)) continue;
    if (BAD_SET.has(token)) return token;
    for (const w of LONG_BAD_WORDS) {
      if (token.includes(w)) return w;
    }
    const sq = squeeze(token);
    if (sq !== token && !ALLOW_SET.has(sq)) {
      for (const w of SQUEEZED_BAD_WORDS) {
        if (sq.includes(w)) return w;
      }
    }
  }

  // Letters spaced out one or two at a time.
  for (const span of spelledOutRuns(norm.tokens)) {
    if (ALLOW_SET.has(span)) continue;
    if (BAD_SET.has(span)) return span;
    for (const w of LONG_BAD_WORDS) {
      if (span.includes(w)) return w;
    }
  }

  // Usernames: look across underscores and digits as one compact string.
  if (opts.joinTokens && norm.tokens.length > 1 && !ALLOW_SET.has(norm.compact)) {
    for (const w of LONG_BAD_WORDS) {
      if (norm.compact.includes(w)) return w;
    }
  }

  return null;
}

function partitionContact(matches: ContactMatch[]) {
  const urls = matches.filter((m) => m.kind === "url").map((m) => m.match);
  const other = matches.filter((m) => m.kind !== "url");
  return { urls, other };
}

export async function filterText(text: string, options: FilterOptions): Promise<FilterResult> {
  const { context } = options;
  const reject = (reason: FilterReason): FilterResult => ({
    verdict: "reject",
    reason,
    userMessage: userMessage(context, "reject"),
  });

  // 1. Length (counted in code points, like the database constraints).
  const trimmed = text.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > MAX_LENGTH[context]) {
    return reject("too_long");
  }

  // 2–4. Normalize, allow-list, bad words.
  if (findBadWord(trimmed, { joinTokens: context === "username" }) !== null) {
    return reject("profanity");
  }

  // 5. Contact information.
  const { urls, other } = partitionContact(findContactInfo(trimmed));
  if (other.length > 0) return reject("contact_info");

  // 6. URL rule.
  if (urls.length > 0) {
    if (!options.allowUrls || options.allowUrls.length === 0) return reject("url");
    for (const u of urls) {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
      if (!checkUrl(candidate, options.allowUrls).ok) return reject("url");
    }
  }

  // 7. Moderation API. Fail closed.
  if (options.moderate) {
    const result = await options.moderate(trimmed);
    if ("error" in result) {
      if (context === "username") return reject("moderation");
      return { verdict: "flag", reason: "moderation", userMessage: userMessage(context, "flag") };
    }
    if (result.flagged) {
      return { ...reject("moderation"), categories: result.categories };
    }
  }

  return { verdict: "allow", userMessage: "", urls: urls.length ? urls : undefined };
}
