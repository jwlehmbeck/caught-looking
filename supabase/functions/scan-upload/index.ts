// scan-upload: first look at a fan edit after it lands in the `uploads`
// bucket (plan U11).
//
// Called by the storage.objects INSERT webhook (migration 20261025131100,
// or the dashboard webhook) and again by the finishUpload server action
// once the post row exists; both send `{ record: { bucket_id, name, ... } }`
// with the shared secret in `x-internal-secret`. The function is idempotent,
// so two calls for one object do one scan.
//
// Steps: find the post for uploads/<name> (waiting briefly if the register
// call has not landed yet) -> size from storage metadata -> magic bytes from
// a 16-byte range request on a signed URL -> uploads_mark_scanning ->
// copy to the short-retention S3 bucket, start Rekognition, run the CSAM
// matcher. With the scanner adapters disabled (no AWS env) the upload goes
// straight to the admin queue marked unscanned; nothing is ever auto-live.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { csamMatcherFromEnv, type CsamMatchResult } from "../_shared/scan/csam.ts";
import { detectVideo, contentTypeFor } from "../_shared/scan/magic-bytes.ts";
import { rekognitionConfigFromEnv, startContentModeration } from "../_shared/scan/rekognition.ts";
import { MAX_UPLOAD_BYTES } from "../_shared/scan/routing.ts";
import { deleteObject, putObject, s3ConfigFromEnv } from "../_shared/scan/s3.ts";

const POST_LOOKUP_TRIES = 6;
const POST_LOOKUP_WAIT_MS = 1500;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

interface StorageRecord {
  bucket_id?: string;
  name?: string;
  owner?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
}

interface PostRow {
  id: number;
  status: string;
  author_id: string | null;
}

async function findPost(db: SupabaseClient, storagePath: string): Promise<PostRow | null> {
  for (let i = 0; i < POST_LOOKUP_TRIES; i += 1) {
    const { data } = await db.from("posts").select("id, status, author_id").eq("storage_path", storagePath).maybeSingle();
    if (data) return data as PostRow;
    await new Promise((r) => setTimeout(r, POST_LOOKUP_WAIT_MS));
  }
  return null;
}

async function signedUrl(db: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await db.storage.from("uploads").createSignedUrl(name, 120);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function readHead(url: string): Promise<{ bytes: Uint8Array; totalSize: number | null }> {
  const res = await fetch(url, { headers: { range: "bytes=0-15" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`head_${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const range = res.headers.get("content-range");
  const total = range ? Number.parseInt(range.split("/")[1] ?? "", 10) : Number.parseInt(res.headers.get("content-length") ?? "", 10);
  return { bytes: buf.slice(0, 16), totalSize: Number.isFinite(total) ? total : null };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return json(401, { error: "unauthorized" });
  }

  let record: StorageRecord | undefined;
  try {
    const body = (await req.json()) as { record?: StorageRecord; type?: string };
    record = body.record;
  } catch {
    return json(400, { error: "bad json" });
  }
  const name = record?.name;
  if (!record || record.bucket_id !== "uploads" || !name) return json(200, { ignored: "not an uploads object" });
  if (!/\.(mp4|mov)$/i.test(name)) return json(200, { ignored: "not a video" });

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("scan-upload: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  const storagePath = `uploads/${name}`;
  const post = await findPost(db, storagePath);
  if (!post) return json(202, { waiting: "no post registered for this object yet" });
  if (post.status !== "pending" && post.status !== "scanning") return json(200, { skipped: post.status });

  const { data: existing } = await db.from("upload_scans").select("status, rekognition_job_id").eq("post_id", post.id).maybeSingle();
  if (existing && (existing as { status: string }).status !== "queued") return json(200, { skipped: "already scanning" });

  const apply = async (outcome: string, details: Record<string, unknown>) => {
    const { error } = await db.rpc("uploads_apply_scan", { p_post_id: post.id, p_outcome: outcome, p_details: details });
    if (error) console.error("scan-upload: apply failed", error.message);
    return error ? json(500, { error: "apply failed" }) : json(200, { post_id: post.id, outcome, ...details });
  };

  // Cheap checks: size from storage metadata, type from magic bytes.
  const url = await signedUrl(db, name);
  if (!url) return json(500, { error: "could not sign the object" });

  let head: { bytes: Uint8Array; totalSize: number | null };
  try {
    head = await readHead(url);
  } catch (err) {
    console.error("scan-upload: head read failed", err);
    return json(502, { error: "could not read the object" });
  }
  const size = typeof record.metadata?.size === "number" ? record.metadata.size : head.totalSize;
  if (size !== null && size > MAX_UPLOAD_BYTES) return apply("reject", { reason: "quality", size });
  const magic = detectVideo(head.bytes);
  if (!magic.ok || !magic.kind) return apply("reject", { reason: "quality", magic: magic.reason, brand: magic.brand });

  const { error: markError } = await db.rpc("uploads_mark_scanning", { p_post_id: post.id, p_job_id: null, p_s3_key: null });
  if (markError) {
    console.error("scan-upload: mark_scanning failed", markError.message);
    return json(500, { error: "mark failed" });
  }

  const s3 = s3ConfigFromEnv();
  const rekognition = rekognitionConfigFromEnv();
  const matcher = csamMatcherFromEnv();
  if (!s3 || !rekognition) {
    return apply("queue_unscanned", { reason: "scanners_disabled", csam_checked: false });
  }

  // Full download once, for the S3 copy and the hash match.
  let file: Uint8Array;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`get_${res.status}`);
    file = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error("scan-upload: download failed", err);
    return apply("queue_unscanned", { reason: "error", csam_checked: false });
  }

  // The matcher decides how to sample; here it gets the whole clip as one
  // input. A match quarantines before Rekognition even starts.
  const csam: CsamMatchResult = await matcher.hashMatchFrames([file]).catch((err: unknown) => {
    console.error("scan-upload: csam matcher failed", err);
    return { checked: false, match: false };
  });
  if (csam.checked) await db.from("upload_scans").update({ csam_checked: true, csam_match: csam.match }).eq("post_id", post.id);
  if (csam.checked && csam.match) {
    return apply("quarantine", { csam_checked: true, provider: csam.provider ?? null });
  }

  const s3Key = `scan/${post.id}/${crypto.randomUUID()}.${magic.kind}`;
  const put = await putObject(s3, s3Key, file, contentTypeFor(magic.kind)).catch((err: unknown) => {
    console.error("scan-upload: s3 put failed", err);
    return null;
  });
  if (!put || put.disabled || !put.ok) {
    return apply("queue_unscanned", { reason: "error", csam_checked: csam.checked });
  }

  const started = await startContentModeration(rekognition, s3.bucket, s3Key, `post-${post.id}`).catch((err: unknown) => {
    console.error("scan-upload: rekognition start failed", err);
    return null;
  });
  if (!started || started.disabled || !started.ok) {
    await deleteObject(s3, s3Key).catch(() => null);
    return apply("queue_unscanned", { reason: "error", csam_checked: csam.checked });
  }

  const { error: jobError } = await db.rpc("uploads_mark_scanning", { p_post_id: post.id, p_job_id: started.jobId, p_s3_key: s3Key });
  if (jobError) console.error("scan-upload: storing job id failed", jobError.message);
  return json(200, { post_id: post.id, scanning: true, job_id: started.jobId });
});
