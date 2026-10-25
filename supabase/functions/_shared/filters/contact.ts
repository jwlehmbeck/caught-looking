/**
 * Contact-information detection (plan U12): phone numbers, @handles,
 * social-app keywords, URLs and emails. Teens must not be able to move a
 * conversation off the app, so these are rejected everywhere.
 */
import { foldCharacters, normalizeText } from "./normalize.ts";

export type ContactKind = "phone" | "handle" | "social" | "url" | "email";

export interface ContactMatch {
  kind: ContactKind;
  match: string;
}

/** Words that invite someone to another app, matched as whole tokens. */
export const SOCIAL_KEYWORDS: readonly string[] = [
  "snap",
  "snapchat",
  "insta",
  "instagram",
  "ig",
  "discord",
  "tiktok",
  "kik",
  "whatsapp",
  "telegram",
  "facetime",
  "hmu",
];

/** Two-word phrases with the same meaning. */
const SOCIAL_PHRASES: readonly string[] = [
  "dm me",
  "dms open",
  "add me",
  "text me",
  "call me",
  "hit me up",
  "message me",
  "my snap",
  "my insta",
  "my discord",
  "my number",
  "my cell",
];

const DIGIT_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
const HANDLE_RE = /(?<![\w.])@\w{3,}/g;
const URL_RE =
  /(?:[a-z][a-z0-9+.-]*:\/\/\S+)|(?:www\.[^\s/]+(?:\/\S*)?)|(?:\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|gg|io|me|tv|app|co)\b(?:\/\S*)?)/gi;
// 10 or more digits, allowing spaces, dashes, dots, parentheses and plus signs
// between them. Letters folded from leetspeak are not involved here: the
// contact pass runs on the raw digits.
const PHONE_RE = /\+?\d(?:[\s\-().]{0,2}\d){9,}/g;

function pushAll(out: ContactMatch[], kind: ContactKind, text: string, re: RegExp) {
  for (const m of text.matchAll(re)) out.push({ kind, match: m[0] });
}

/** Spans of tokens that are all 1–2 characters: "s n a p", "i g". */
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

/** Returns every piece of contact information found, or an empty array. */
export function findContactInfo(text: string): ContactMatch[] {
  const out: ContactMatch[] = [];
  const flat = foldCharacters(text);

  pushAll(out, "email", flat, EMAIL_RE);
  const withoutEmails = flat.replace(EMAIL_RE, " ");
  pushAll(out, "url", withoutEmails, URL_RE);
  pushAll(out, "handle", withoutEmails, HANDLE_RE);
  for (const m of withoutEmails.matchAll(PHONE_RE)) {
    // A list of years ("2021 2022 2023") is not a phone number.
    const groups = m[0].split(/\D+/).filter(Boolean);
    if (groups.every((g) => /^(?:19|20)\d\d$/.test(g))) continue;
    out.push({ kind: "phone", match: m[0] });
  }

  // Spelled-out phone number: seven or more digit words in a row.
  const rawTokens = normalizeText(text, { keepDigits: true }).tokens;
  let run: string[] = [];
  const flushRun = () => {
    if (run.length >= 7) out.push({ kind: "phone", match: run.join(" ") });
    run = [];
  };
  for (const t of rawTokens) {
    if (DIGIT_WORDS.has(t) || /^\d$/.test(t)) run.push(t);
    else flushRun();
  }
  flushRun();

  // Social keywords on whole tokens, in two-word phrases, and spelled out.
  const norm = normalizeText(text);
  const tokenSet = new Set(norm.tokens);
  for (const kw of SOCIAL_KEYWORDS) {
    if (tokenSet.has(kw)) out.push({ kind: "social", match: kw });
  }
  const joined = norm.tokens.join(" ");
  for (const phrase of SOCIAL_PHRASES) {
    if (new RegExp(`(?:^| )${phrase}(?: |$)`).test(joined)) {
      out.push({ kind: "social", match: phrase });
    }
  }
  for (const span of spelledOutRuns(norm.tokens)) {
    for (const kw of SOCIAL_KEYWORDS) {
      if (kw.length >= 3 && span.includes(kw)) out.push({ kind: "social", match: kw });
    }
  }

  return out;
}
