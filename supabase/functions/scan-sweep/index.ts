// scan-sweep: picks up scans whose SNS callback never arrived (plan U11).
//
// pg_cron calls it every 10 minutes (migration 20261025131100) with the
// shared secret. For every scan still 'scanning' after 15 minutes it polls
// GetContentModeration; a finished job is routed exactly as scan-complete
// would, a job still running (or an unreachable Rekognition) sends the
// upload to the admin queue marked unscanned and alerts the admin.
//
// Deno runtime. Shared code is imported with relative paths.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { completeScan } from "../_shared/scan/complete.ts";
import { rekognitionConfigFromEnv } from "../_shared/scan/rekognition.ts";
import { s3ConfigFromEnv } from "../_shared/scan/s3.ts";

const MAX_PER_RUN = 50;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

interface PendingRow {
  post_id: number;
  rekognition_job_id: string | null;
  s3_key: string | null;
  started_at: string;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) return json(401, { error: "unauthorized" });

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error("scan-sweep: misconfigured", err);
    return json(500, { error: "misconfigured" });
  }

  const { data, error } = await db.rpc("uploads_pending_scans");
  if (error) return json(500, { error: error.message });
  const rows = ((data ?? []) as PendingRow[]).slice(0, MAX_PER_RUN);

  const deps = { rpc: (fn: string, args: Record<string, unknown>) => db.rpc(fn, args), rekognition: rekognitionConfigFromEnv(), s3: s3ConfigFromEnv() };
  const summary: { post_id: number; state: string; outcome?: string }[] = [];
  for (const row of rows) {
    const { data: scan } = await db.from("upload_scans").select("csam_checked, csam_match").eq("post_id", row.post_id).maybeSingle();
    const flags = (scan ?? { csam_checked: false, csam_match: false }) as { csam_checked: boolean; csam_match: boolean };
    try {
      const result = await completeScan(
        deps,
        { postId: row.post_id, jobId: row.rekognition_job_id, s3Key: row.s3_key, csamChecked: flags.csam_checked, csamMatch: flags.csam_match },
        { timedOut: true },
      );
      summary.push({ post_id: row.post_id, state: result.state, outcome: result.state === "applied" ? result.route.outcome : undefined });
    } catch (err) {
      console.error("scan-sweep: post failed", row.post_id, err);
      summary.push({ post_id: row.post_id, state: "error" });
    }
  }
  return json(200, { swept: summary.length, results: summary });
});
