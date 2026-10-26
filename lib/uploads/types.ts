/** Shapes shared by the upload server actions and components (plan U11). */

import type { RejectionReason } from "@shared/scan/routing.ts";

export type UploadStatus = "pending" | "scanning" | "live" | "hidden" | "removed" | "rejected";

export interface BeginUploadInput {
  title: string;
  teamId: number | null;
  gameId: number | null;
  durationSeconds: number;
  sizeBytes: number;
  mime: string;
}

export type BeginUploadResult =
  | {
      ok: true;
      /** Object name inside the `uploads` bucket: `{user_id}/{uuid}.mp4`. */
      objectName: string;
      /** The post's storage_path: `uploads/{user_id}/{uuid}.mp4`. */
      storagePath: string;
      /** Supabase's TUS endpoint. */
      endpoint: string;
      contentType: string;
    }
  | { ok: false; message: string };

export interface FinishUploadInput {
  objectName: string;
  title: string;
  teamId: number | null;
  gameId: number | null;
  durationSeconds: number;
  /** data:image/jpeg;base64,… captured by the uploader, 200 KB or less. */
  thumbnailDataUrl?: string | null;
}

export type FinishUploadResult = { ok: true; postId: number } | { ok: false; message: string };

export interface MyUpload {
  id: number;
  title: string;
  status: UploadStatus;
  rejectionReason: RejectionReason | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  teamAbbreviation: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface QueuedUpload {
  id: number;
  title: string;
  authorId: string | null;
  authorUsername: string | null;
  teamAbbreviation: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  scanStatus: "queued" | "scanning" | "complete" | "timeout" | "error";
  labels: { Name?: string; ParentName?: string; Confidence?: number }[];
  durationMs: number | null;
  csamChecked: boolean;
}

export type UploadActionResult = { ok: true; message: string } | { ok: false; message: string };

export type PlaybackResult = { ok: true; url: string; expiresInSeconds: number } | { ok: false; message: string };
