"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { openAiModerator } from "@shared/filters/moderation.ts";
import { filterText } from "@shared/filters/pipeline.ts";
import type { RejectionReason } from "@shared/scan/routing.ts";
import { MAX_DURATION_SECONDS, THUMBNAIL_MAX_BYTES, validateUploadMeta } from "@shared/scan/upload-rules.ts";

import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

import type {
  BeginUploadInput,
  BeginUploadResult,
  FinishUploadInput,
  FinishUploadResult,
  MyUpload,
  PlaybackResult,
  QueuedUpload,
  UploadActionResult,
  UploadStatus,
} from "@/lib/uploads/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TITLE_REJECT_COPY = "That title can't be used.";
const GENERIC_FAIL = "That didn't go through. Try again.";
const PLAYBACK_TTL_SECONDS = 60;
const THUMBNAIL_TTL_SECONDS = 600;
const REASONS: RejectionReason[] = ["copyright", "personal_info", "contact_info", "off_topic", "quality", "unsafe"];

async function viewerId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/** Runs the title through the filter pipeline. Fails closed: a flag is a reject for uploads. */
async function titleAllowed(title: string): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  const verdict = await filterText(title, { context: "title", moderate: apiKey ? openAiModerator(apiKey) : undefined });
  return verdict.verdict === "allow";
}

function parseObjectName(uid: string, objectName: string): { uuid: string; extension: "mp4" | "mov" } | null {
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|mov)$/.exec(objectName);
  if (!m || m[1] !== uid || !UUID_RE.test(m[2])) return null;
  return { uuid: m[2], extension: m[3] as "mp4" | "mov" };
}

function cleanId(value: number | null): number | null {
  return value === null || (Number.isInteger(value) && value > 0) ? value : Number.NaN;
}

/**
 * Validates the clip's metadata and the title, then hands the client a
 * write-once path in its own folder. The browser uploads straight to the
 * TUS endpoint with its own session; storage policies enforce the folder,
 * the daily cap and the no-overwrite rule again.
 */
export async function beginUpload(input: BeginUploadInput): Promise<BeginUploadResult> {
  const uid = await viewerId();
  if (!uid) return { ok: false, message: "Sign in to upload." };

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return { ok: false, message: "Give it a title." };
  if (Array.from(title).length > 140) return { ok: false, message: "Keep the title to 140 characters." };

  const meta = validateUploadMeta({ durationSeconds: Number(input.durationSeconds), sizeBytes: Number(input.sizeBytes), mime: String(input.mime) });
  if (!meta.ok) return { ok: false, message: meta.message };
  if (Number.isNaN(cleanId(input.teamId)) || Number.isNaN(cleanId(input.gameId))) return { ok: false, message: GENERIC_FAIL };

  if (!(await titleAllowed(title))) return { ok: false, message: TITLE_REJECT_COPY };

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("status").eq("id", uid).maybeSingle();
  if ((profile as { status: string } | null)?.status !== "active") return { ok: false, message: "Your account can't upload right now." };

  const objectName = `${uid}/${randomUUID()}.${meta.extension}`;
  const { url } = supabaseEnv();
  return {
    ok: true,
    objectName,
    storagePath: `uploads/${objectName}`,
    endpoint: `${url.replace(/\/$/, "")}/storage/v1/upload/resumable`,
    contentType: meta.extension === "mov" ? "video/quicktime" : "video/mp4",
  };
}

function decodeThumbnail(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > THUMBNAIL_MAX_BYTES) return null;
  // JPEG SOI marker.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return new Uint8Array(bytes);
}

/** Asks scan-upload to look at the object now instead of waiting for the webhook. Best effort. */
async function nudgeScanner(objectName: string): Promise<void> {
  const secret = process.env.INTERNAL_FUNCTION_SECRET;
  if (!secret) return;
  const { url } = supabaseEnv();
  await fetch(`${url.replace(/\/$/, "")}/functions/v1/scan-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ type: "INSERT", record: { bucket_id: "uploads", name: objectName } }),
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
}

/**
 * After the TUS upload finished: confirms the object exists, stores the
 * thumbnail next to it, registers the pending post through the service RPC
 * (which re-checks the 3-a-day cap) and nudges the scanner.
 */
export async function finishUpload(input: FinishUploadInput): Promise<FinishUploadResult> {
  const uid = await viewerId();
  if (!uid) return { ok: false, message: "Sign in to upload." };
  const parsed = typeof input.objectName === "string" ? parseObjectName(uid, input.objectName) : null;
  if (!parsed) return { ok: false, message: GENERIC_FAIL };

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0 || Array.from(title).length > 140) return { ok: false, message: "Give it a title of up to 140 characters." };
  if (!(await titleAllowed(title))) return { ok: false, message: TITLE_REJECT_COPY };

  const duration = Math.round(Number(input.durationSeconds));
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION_SECONDS) {
    return { ok: false, message: `Clips are ${MAX_DURATION_SECONDS} seconds or less.` };
  }
  const teamId = cleanId(input.teamId);
  const gameId = cleanId(input.gameId);
  if (Number.isNaN(teamId) || Number.isNaN(gameId)) return { ok: false, message: GENERIC_FAIL };

  const admin = createAdminClient();

  // The object must exist and be a video (the TUS upload is done).
  const { data: listed, error: listError } = await admin.storage.from("uploads").list(uid, { search: `${parsed.uuid}.${parsed.extension}`, limit: 1 });
  if (listError || !listed || listed.length === 0) return { ok: false, message: "The upload didn't finish. Try again." };

  let thumbnailPath: string | null = null;
  const thumb = decodeThumbnail(input.thumbnailDataUrl);
  if (thumb) {
    const thumbName = `${uid}/${parsed.uuid}.jpg`;
    const { error: thumbError } = await admin.storage.from("uploads").upload(thumbName, thumb, { contentType: "image/jpeg", upsert: false });
    if (!thumbError) thumbnailPath = `uploads/${thumbName}`;
  }

  const { data, error } = await admin.rpc("uploads_register", {
    p_user_id: uid,
    p_storage_path: `uploads/${input.objectName}`,
    p_title: title,
    p_team_id: teamId,
    p_game_id: gameId,
    p_client_duration: duration,
    p_thumbnail_path: thumbnailPath,
  });
  if (error) {
    // Nothing keeps an unregistered file around.
    await admin.storage.from("uploads").remove([input.objectName, ...(thumbnailPath ? [thumbnailPath.replace(/^uploads\//, "")] : [])]).catch(() => null);
    if (error.code === "P0001") return { ok: false, message: "You've hit 3 uploads for today. Try again tomorrow." };
    if (error.code === "42501" && /suspended/i.test(error.message)) return { ok: false, message: "Your account is suspended." };
    if (error.code === "23505") return { ok: false, message: "That file was already submitted." };
    return { ok: false, message: GENERIC_FAIL };
  }

  await nudgeScanner(input.objectName);
  revalidatePath("/profile/uploads");
  return { ok: true, postId: Number(data) };
}

async function signedUrls(bucket: "uploads" | "media", paths: (string | null)[], ttl: number): Promise<Map<string, string>> {
  const names = Array.from(new Set(paths.filter((p): p is string => typeof p === "string" && p.startsWith(`${bucket}/`)))).map((p) =>
    p.slice(bucket.length + 1),
  );
  const out = new Map<string, string>();
  if (names.length === 0) return out;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrls(names, ttl);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(`${bucket}/${row.path}`, row.signedUrl);
  }
  return out;
}

interface MyUploadRow {
  id: number;
  title: string;
  status: UploadStatus;
  rejection_reason: RejectionReason | null;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  team_abbreviation: string | null;
  created_at: string;
  published_at: string | null;
}

/** The viewer's own fan edits with their review state. */
export async function getMyUploads(): Promise<MyUpload[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_uploads");
  if (error) return [];
  const rows = (data ?? []) as MyUploadRow[];
  const thumbs = await signedUrls("uploads", rows.map((r) => r.thumbnail_path), THUMBNAIL_TTL_SECONDS);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    rejectionReason: r.rejection_reason,
    thumbnailUrl: r.thumbnail_path ? (thumbs.get(r.thumbnail_path) ?? null) : null,
    durationSeconds: r.duration_seconds,
    teamAbbreviation: r.team_abbreviation,
    createdAt: r.created_at,
    publishedAt: r.published_at,
  }));
}

interface QueueRow {
  id: number;
  title: string;
  author_id: string | null;
  author_username: string | null;
  team_abbreviation: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  created_at: string;
  scan_status: QueuedUpload["scanStatus"];
  labels: QueuedUpload["labels"] | null;
  duration_ms: number | null;
  csam_checked: boolean;
}

async function queueRows(): Promise<QueueRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upload_queue");
  if (error) return null;
  return (data ?? []) as QueueRow[];
}

/** The admin approval queue (the RPC itself refuses non-admins). */
export async function getUploadQueue(): Promise<{ rows: QueuedUpload[]; error: string | null }> {
  const rows = await queueRows();
  if (rows === null) return { rows: [], error: "Couldn't load the upload queue." };
  const thumbs = await signedUrls("uploads", rows.map((r) => r.thumbnail_path), THUMBNAIL_TTL_SECONDS);
  return {
    error: null,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      authorId: r.author_id,
      authorUsername: r.author_username,
      teamAbbreviation: r.team_abbreviation,
      thumbnailUrl: r.thumbnail_path ? (thumbs.get(r.thumbnail_path) ?? null) : null,
      durationSeconds: r.duration_seconds,
      createdAt: r.created_at,
      scanStatus: r.scan_status,
      labels: r.labels ?? [],
      durationMs: r.duration_ms,
      csamChecked: r.csam_checked,
    })),
  };
}

/** A 60-second signed URL to a queued upload, for the admin's review player. */
export async function getQueuePreviewUrl(postId: number): Promise<PlaybackResult> {
  if (!Number.isInteger(postId)) return { ok: false, message: GENERIC_FAIL };
  const rows = await queueRows();
  const row = rows?.find((r) => r.id === postId);
  if (!row) return { ok: false, message: "That upload isn't in the queue." };
  const urls = await signedUrls("uploads", [row.storage_path], PLAYBACK_TTL_SECONDS);
  const url = urls.get(row.storage_path);
  return url ? { ok: true, url, expiresInSeconds: PLAYBACK_TTL_SECONDS } : { ok: false, message: GENERIC_FAIL };
}

/**
 * Approves a queued upload: copies the file to `media/{sha256}.{ext}` (so
 * identical files share one object) and flips the post live through the
 * admin-only RPC.
 */
export async function approveUpload(postId: number): Promise<UploadActionResult> {
  if (!Number.isInteger(postId)) return { ok: false, message: GENERIC_FAIL };
  const rows = await queueRows();
  const row = rows?.find((r) => r.id === postId);
  if (!row) return { ok: false, message: "That upload isn't in the queue." };

  const objectName = row.storage_path.replace(/^uploads\//, "");
  const extension = objectName.endsWith(".mov") ? "mov" : "mp4";
  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from("uploads").download(objectName);
  if (downloadError || !blob) return { ok: false, message: "Couldn't read the file." };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const mediaName = `${hash}.${extension}`;

  const { error: copyError } = await admin.storage.from("uploads").copy(objectName, mediaName, { destinationBucket: "media" });
  if (copyError && !/exists|duplicate/i.test(copyError.message)) {
    return { ok: false, message: "Couldn't copy the file to media." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_upload", { p_post_id: postId, p_media_path: `media/${mediaName}` });
  revalidatePath("/mod");
  revalidatePath("/feed");
  if (error) return { ok: false, message: error.code === "42501" ? "Admins only." : GENERIC_FAIL };
  return { ok: true, message: "Approved. It's in the feed." };
}

export async function rejectUpload(postId: number, reason: string): Promise<UploadActionResult> {
  if (!Number.isInteger(postId) || !REASONS.includes(reason as RejectionReason)) return { ok: false, message: "Pick a reason from the list." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_upload", { p_post_id: postId, p_reason: reason });
  revalidatePath("/mod");
  if (error) return { ok: false, message: error.code === "42501" ? "Admins only." : GENERIC_FAIL };
  return { ok: true, message: "Rejected." };
}

/** Form action for the Uploads tab buttons. */
export async function uploadQueueAction(formData: FormData): Promise<void> {
  const action = String(formData.get("action") ?? "");
  const postId = Number(formData.get("post_id") ?? 0);
  if (action === "approve") await approveUpload(postId);
  else if (action === "reject") await rejectUpload(postId, String(formData.get("reason") ?? ""));
}

/**
 * A 60-second signed URL for a live fan edit. post_detail applies the
 * live/blocked rules; only `media/` objects are ever served to members.
 */
export async function getPlaybackUrl(postId: number): Promise<PlaybackResult> {
  if (!Number.isInteger(postId)) return { ok: false, message: GENERIC_FAIL };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_detail", { p_post_id: postId });
  if (error) return { ok: false, message: "That clip isn't available." };
  const row = ((data ?? []) as { kind: string; status: string }[])[0];
  if (!row || row.kind !== "fan_edit" || row.status !== "live") return { ok: false, message: "That clip isn't available." };

  const { data: post } = await supabase.from("posts").select("storage_path").eq("id", postId).maybeSingle();
  const path = (post as { storage_path: string | null } | null)?.storage_path;
  if (!path || !path.startsWith("media/")) return { ok: false, message: "That clip isn't available." };
  const urls = await signedUrls("media", [path], PLAYBACK_TTL_SECONDS);
  const url = urls.get(path);
  return url ? { ok: true, url, expiresInSeconds: PLAYBACK_TTL_SECONDS } : { ok: false, message: GENERIC_FAIL };
}

/** A short-lived URL for a post's thumbnail (feed cards, lists). */
export async function getThumbnailUrl(thumbnailPath: string | null): Promise<string | null> {
  if (!thumbnailPath || !thumbnailPath.startsWith("uploads/") || !thumbnailPath.endsWith(".jpg")) return null;
  const uid = await viewerId();
  if (!uid) return null;
  const urls = await signedUrls("uploads", [thumbnailPath], THUMBNAIL_TTL_SECONDS);
  return urls.get(thumbnailPath) ?? null;
}

