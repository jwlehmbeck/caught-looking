// scan-complete: the Rekognition job finished (plan U11).
//
// Two callers:
//   * Amazon SNS, subscribed as an HTTPS endpoint. SNS cannot set custom
//     headers, so the subscription URL carries the secret:
//       https://<ref>.supabase.co/functions/v1/scan-complete?secret=<INTERNAL_FUNCTION_SECRET>
//     The first message is a `SubscriptionConfirmation`; this function
//     confirms it by fetching `SubscribeURL`. Notifications carry a JSON
//     `Message` with `JobId` and `Status`. v1 trusts the shared secret;
//     verifying the SNS signature (SigningCertURL) is a follow-up.
//   * Internal callers (manual re-run) with `x-internal-secret` and a body
//     of `{ post_id }` or `{ job_id }`.
//
// The decision itself lives in _shared/scan/complete.ts so the sweep takes
// the same path. Idempotent: uploads_apply_scan ignores decided posts.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { completeScan, type PendingScan } from "../_shared/scan/complete.ts";
import { rekognitionConfigFromEnv } from "../_shared/scan/rekognition.ts";
import { s3ConfigFromEnv } from "../_shared/scan/s3.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

interface ScanRow {
  post_id: number;
  rekognition_job_id: string | null;
  s3_key: string | null;
  csam_checked: boolean;
  csam_match: boolean;
}

function toPending(row: ScanRow): PendingScan {
  return { postId: row.post_id, jobId: row.rekognition_job_id, s3Key: row.s3_key, csamChecked: row.csam_checked, csamMatch: row.csam_match };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  const url = new URL(req.url);
  const presented = req.headers.get("x-internal-secret") ?? url.searchParams.get("secret");
  if (!secret || presented !== secret) return json(401, { error: "unauthorized" });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad json" });
  }

  // SNS envelope.
  const snsType = req.headers.get("x-amz-sns-message-type") ?? (typeof body.Type === "string" ? body.Type : null);
  let jobId: string | null = null;
  let postId: number | null = null;
  if (snsType === "SubscriptionConfirmation") {
    const subscribeUrl = typeof body.SubscribeURL === "string" ? body.SubscribeURL : null;
    if (!subscribeUrl || !/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(subscribeUrl)) return json(400, { error: "bad SubscribeURL" });
    const res = await fetch(subscribeUrl).catch(() => null);
    return json(res?.ok ? 200 : 502, { confirmed: res?.ok ?? false });
  }
  if (snsType === "UnsubscribeConfirmation") return json(200, { ignored: snsType });
  if (snsType === "Notification") {
    try {
      const message = JSON.parse(String(body.Message ?? "{}")) as { JobId?: string };
      jobId = message.JobId ?? null;
    } catch {
      return json(400, { error: "bad Message" });
    }
  } else {
    if (typeof body.job_id === "string") jobId = body.job_id;
    if (typeof body.post_id === "number") postId = body.post_id;
  }
  if (!jobId && postId === null) return json(400, { error: "job_id or post_id required" });

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("scan-complete: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  const query = db.from("upload_scans").select("post_id, rekognition_job_id, s3_key, csam_checked, csam_match");
  const { data, error } = postId !== null ? await query.eq("post_id", postId).maybeSingle() : await query.eq("rekognition_job_id", jobId!).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: "unknown job" });

  const result = await completeScan(
    {
      rpc: (fn, args) => db.rpc(fn, args),
      rekognition: rekognitionConfigFromEnv(),
      s3: s3ConfigFromEnv(),
    },
    toPending(data as ScanRow),
  );
  if (result.state === "error") return json(500, { error: result.message });
  return json(200, result);
});
