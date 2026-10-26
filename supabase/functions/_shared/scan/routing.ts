/**
 * Scan routing (plan U11). Pure: takes what the scanners said and returns
 * where the upload goes. The order is fixed and a match higher up wins:
 *
 *   1. CSAM hash match                      -> quarantine (held, admin alert)
 *   2. bad magic bytes / over the size cap  -> reject
 *   3. explicit labels at >= 80% confidence -> reject ('unsafe', admin alert)
 *   4. duration over 60 s                   -> reject ('quality')
 *   5. scanners never finished              -> queue_unscanned
 *   6. otherwise                            -> queue (admin approval)
 */

export const MAX_DURATION_SECONDS = 60;
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
export const EXPLICIT_CONFIDENCE = 80;

export type ScanOutcome = "quarantine" | "reject" | "queue" | "queue_unscanned";

export type RejectionReason = "copyright" | "personal_info" | "contact_info" | "off_topic" | "quality" | "unsafe";

export interface ModerationLabel {
  Name?: string;
  ParentName?: string;
  Confidence?: number;
}

export interface ScanInput {
  /** Result of the hash match: match, clean, or not checked. */
  csam: { checked: boolean; match: boolean };
  labels?: ModerationLabel[] | null;
  durationMs?: number | null;
  magicOk: boolean;
  sizeOk: boolean;
  timedOut?: boolean;
}

export interface ScanRoute {
  outcome: ScanOutcome;
  reason?: RejectionReason | "timeout" | "scanners_disabled" | "error";
  /** The labels that drove a reject, for the admin alert. */
  matchedLabels?: ModerationLabel[];
}

const EXPLICIT_PARENTS = new Set([
  "Explicit Nudity",
  "Explicit",
  "Non-Explicit Nudity of Intimate parts and Kissing",
  "Sexual Activity",
]);
const EXPLICIT_NAME = /nudity|sexual/i;

export function isExplicitLabel(label: ModerationLabel): boolean {
  const confidence = typeof label.Confidence === "number" ? label.Confidence : 0;
  if (confidence < EXPLICIT_CONFIDENCE) return false;
  if (label.ParentName && EXPLICIT_PARENTS.has(label.ParentName)) return true;
  if (label.Name && EXPLICIT_PARENTS.has(label.Name)) return true;
  return Boolean(label.Name && EXPLICIT_NAME.test(label.Name));
}

export function routeScan(input: ScanInput): ScanRoute {
  if (input.csam.checked && input.csam.match) return { outcome: "quarantine" };
  if (!input.magicOk) return { outcome: "reject", reason: "quality" };
  if (!input.sizeOk) return { outcome: "reject", reason: "quality" };

  const matched = (input.labels ?? []).filter(isExplicitLabel);
  if (matched.length > 0) return { outcome: "reject", reason: "unsafe", matchedLabels: matched };

  if (typeof input.durationMs === "number" && input.durationMs > MAX_DURATION_SECONDS * 1000) {
    return { outcome: "reject", reason: "quality" };
  }

  if (input.timedOut) return { outcome: "queue_unscanned", reason: "timeout" };
  return { outcome: "queue" };
}
