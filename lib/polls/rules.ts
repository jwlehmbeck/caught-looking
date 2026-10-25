/**
 * Pure poll rules shared by the form, the card and the tests (plan U13).
 * No React, no Supabase: everything here is a function of its inputs.
 */

export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 80;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;

export const CLOSE_CHOICES = [
  { value: "1h", label: "1 hour", hours: 1 },
  { value: "6h", label: "6 hours", hours: 6 },
  { value: "24h", label: "24 hours", hours: 24 },
  { value: "3d", label: "3 days", hours: 72 },
] as const;

export type CloseChoice = (typeof CLOSE_CHOICES)[number]["value"];

export function closesAtFor(choice: string, now: Date = new Date()): Date | null {
  const c = CLOSE_CHOICES.find((x) => x.value === choice);
  if (!c) return null;
  return new Date(now.getTime() + c.hours * 60 * 60 * 1000);
}

export interface PollTeam {
  id: number;
  abbreviation: string;
  name: string;
  color: string;
}

export interface PollOption {
  id: number;
  label: string;
  sort_order: number;
  /** Null until the viewer may see results. */
  count: number | null;
}

export interface PollView {
  id: number;
  question: string;
  status: "open" | "closed" | "hidden";
  closes_at: string;
  created_at: string;
  game_id: number | null;
  team_a: PollTeam | null;
  team_b: PollTeam | null;
  total: number | null;
  results_visible: boolean;
  my_option_id: number | null;
  options: PollOption[];
}

/** Results show after the viewer voted or once the poll is closed. */
export function resultsVisible(input: { status: string; closesAt: string | Date; myOptionId: number | null }, now: Date = new Date()): boolean {
  return input.myOptionId !== null || isClosed(input, now);
}

export function isClosed(input: { status: string; closesAt: string | Date }, now: Date = new Date()): boolean {
  if (input.status !== "open") return true;
  const t = new Date(input.closesAt).getTime();
  return Number.isNaN(t) || t <= now.getTime();
}

/** "Closes in 2h 05m", "Closes in 3d", "Closed". */
export function closesInLabel(input: { status: string; closesAt: string | Date }, now: Date = new Date()): string {
  if (isClosed(input, now)) return "Closed";
  const ms = new Date(input.closesAt).getTime() - now.getTime();
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) return hours > 0 ? `Closes in ${days}d ${hours}h` : `Closes in ${days}d`;
  if (hours >= 1) return `Closes in ${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `Closes in ${minutes}m`;
}

/** Whole-number percentages that sum to 100 (largest remainder). */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

export type PollValidation =
  | { ok: true; question: string; options: string[] }
  | { ok: false; message: string };

/** Trims, drops empty option fields, and checks lengths and counts. */
export function validatePollInput(questionRaw: string, optionsRaw: string[]): PollValidation {
  const question = questionRaw.trim();
  if (question.length === 0) return { ok: false, message: "Ask a question." };
  if (Array.from(question).length > POLL_QUESTION_MAX) {
    return { ok: false, message: `Keep the question under ${POLL_QUESTION_MAX} characters.` };
  }
  const options = optionsRaw.map((o) => o.trim()).filter((o) => o.length > 0);
  if (options.length < POLL_MIN_OPTIONS) return { ok: false, message: `Give at least ${POLL_MIN_OPTIONS} options.` };
  if (options.length > POLL_MAX_OPTIONS) return { ok: false, message: `No more than ${POLL_MAX_OPTIONS} options.` };
  for (const o of options) {
    if (Array.from(o).length > POLL_OPTION_MAX) {
      return { ok: false, message: `Keep each option under ${POLL_OPTION_MAX} characters.` };
    }
  }
  const seen = new Set<string>();
  for (const o of options) {
    const key = o.toLowerCase();
    if (seen.has(key)) return { ok: false, message: "Options need to be different from each other." };
    seen.add(key);
  }
  return { ok: true, question, options };
}
