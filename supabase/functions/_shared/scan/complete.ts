/**
 * Finishing a scan (plan U11): read the Rekognition result, route it, apply
 * the outcome through the service RPC and drop the S3 copy. Shared by
 * scan-complete (SNS callback) and scan-sweep (jobs pending > 15 min), so
 * both take exactly the same decisions. Runtime-neutral: the database is an
 * `rpc` function, the scanners are the adapters in this folder.
 */
import { getContentModeration, type RekognitionConfig } from "./rekognition.ts";
import { routeScan, type ModerationLabel, type ScanRoute } from "./routing.ts";
import { deleteObject, type S3Config } from "./s3.ts";

export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

export interface CompleteDeps {
  rpc: RpcFn;
  rekognition: RekognitionConfig | null;
  s3: S3Config | null;
  log?: (message: string, ...rest: unknown[]) => void;
}

export interface PendingScan {
  postId: number;
  jobId: string | null;
  s3Key: string | null;
  csamChecked: boolean;
  csamMatch: boolean;
}

export type CompleteResult =
  | { state: "in_progress" }
  | { state: "applied"; route: ScanRoute }
  | { state: "error"; message: string };

/** Keep the alert payload small: the strongest 20 labels, three fields each. */
export function trimLabels(labels: ModerationLabel[]): ModerationLabel[] {
  return [...labels]
    .sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))
    .slice(0, 20)
    .map((l) => ({ Name: l.Name, ParentName: l.ParentName, Confidence: typeof l.Confidence === "number" ? Math.round(l.Confidence * 10) / 10 : undefined }));
}

export async function completeScan(deps: CompleteDeps, scan: PendingScan, options: { timedOut?: boolean } = {}): Promise<CompleteResult> {
  const log = deps.log ?? console.error;
  const apply = async (route: ScanRoute, details: Record<string, unknown>) => {
    const { error } = await deps.rpc("uploads_apply_scan", {
      p_post_id: scan.postId,
      p_outcome: route.outcome,
      p_details: { ...details, reason: route.reason ?? details.reason ?? null, job_id: scan.jobId, csam_checked: scan.csamChecked },
    });
    if (error) return { state: "error" as const, message: error.message };
    if (scan.s3Key) {
      const del = await deleteObject(deps.s3, scan.s3Key).catch((err: unknown) => {
        log("scan: s3 delete failed", err);
        return null;
      });
      if (del && !del.disabled && !del.ok) log("scan: s3 delete returned", del.status);
    }
    return { state: "applied" as const, route };
  };

  if (scan.csamChecked && scan.csamMatch) {
    return apply({ outcome: "quarantine" }, {});
  }

  if (!deps.rekognition || !scan.jobId) {
    return apply({ outcome: "queue_unscanned", reason: "scanners_disabled" }, {});
  }

  const result = await getContentModeration(deps.rekognition, scan.jobId);
  if (result.disabled) return apply({ outcome: "queue_unscanned", reason: "scanners_disabled" }, {});
  if (!result.ok) {
    log("scan: GetContentModeration failed", result.status, result.error);
    if (!options.timedOut) return { state: "error", message: `rekognition_${result.status}` };
    return apply({ outcome: "queue_unscanned", reason: "timeout" }, {});
  }

  const { status, labels, durationMs } = result.result;
  if (status === "IN_PROGRESS") {
    if (!options.timedOut) return { state: "in_progress" };
    return apply(routeScan({ csam: { checked: scan.csamChecked, match: scan.csamMatch }, magicOk: true, sizeOk: true, timedOut: true }), {});
  }
  if (status === "FAILED") {
    return apply({ outcome: "queue_unscanned", reason: "error" }, { status_message: result.result.statusMessage ?? null });
  }

  const route = routeScan({
    csam: { checked: scan.csamChecked, match: scan.csamMatch },
    labels,
    durationMs,
    magicOk: true,
    sizeOk: true,
  });
  return apply(route, { labels: trimLabels(route.matchedLabels ?? labels), duration_ms: durationMs });
}
