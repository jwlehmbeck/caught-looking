/**
 * Upload rules shared by the uploader (before the file leaves the phone),
 * the server action (before a path is handed out) and scan-upload (plan
 * U11). Pure.
 */
import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, type RejectionReason } from "./routing.ts";

export { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES };

export const UPLOADS_PER_DAY = 3;
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
export const THUMBNAIL_MAX_BYTES = 200 * 1024;

export const ALLOWED_MIME: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export interface UploadMeta {
  durationSeconds: number;
  sizeBytes: number;
  mime: string;
}

export type UploadValidation =
  | { ok: true; extension: "mp4" | "mov" }
  | { ok: false; reason: "too_long" | "too_big" | "empty" | "bad_type" | "bad_duration"; message: string };

export function validateUploadMeta(meta: UploadMeta): UploadValidation {
  const extension = ALLOWED_MIME[meta.mime];
  if (!extension) return { ok: false, reason: "bad_type", message: "Use an MP4 or MOV file." };
  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) return { ok: false, reason: "empty", message: "That file is empty." };
  if (meta.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_big", message: "Keep it under 150 MB." };
  if (!Number.isFinite(meta.durationSeconds) || meta.durationSeconds <= 0) {
    return { ok: false, reason: "bad_duration", message: "Couldn't read the clip's length. Try another file." };
  }
  if (meta.durationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, reason: "too_long", message: `Clips are ${MAX_DURATION_SECONDS} seconds or less. Trim it and try again.` };
  }
  return { ok: true, extension };
}

/** What the uploader reads for each rejection reason. Plain words, no blame. */
export const REJECTION_COPY: Record<RejectionReason, string> = {
  copyright: "It used footage or music that isn't yours to share.",
  personal_info: "It showed a face, a name, a school or a place that could identify someone.",
  contact_info: "It included a username, phone number or other way to contact someone.",
  off_topic: "It wasn't about baseball.",
  quality: "It was too long, too blurry or didn't play right.",
  unsafe: "It didn't meet the safety rules.",
};

export const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: "copyright", label: "Copyright (not their footage or music)" },
  { value: "personal_info", label: "Face or personal info" },
  { value: "contact_info", label: "Contact info" },
  { value: "off_topic", label: "Off topic" },
  { value: "quality", label: "Quality or length" },
  { value: "unsafe", label: "Unsafe" },
];

export const PENDING_COPY = "Pending review — usually within a day.";
