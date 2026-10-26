/**
 * Amazon Rekognition video content moderation (plan U11): start an async
 * job on an S3 object with an SNS completion topic, and read its results.
 * JSON 1.1 protocol signed with SigV4; no SDK.
 *
 * Disabled mode: without AWS credentials each call returns
 * `{ disabled: true }` so scan-upload falls through to `queue_unscanned`.
 */
import { readEnv } from "../alerts/index.ts";
import type { ModerationLabel } from "./routing.ts";
import { signRequest, type AwsCredentials } from "./sigv4.ts";

export interface RekognitionConfig {
  region: string;
  credentials: AwsCredentials;
  /** SNS topic Rekognition notifies when the job finishes. */
  snsTopicArn?: string;
  /** IAM role Rekognition assumes to publish to the topic. */
  roleArn?: string;
  endpoint?: string;
  fetch?: typeof fetch;
}

export type StartResult = { disabled: true } | { disabled: false; ok: true; jobId: string } | { disabled: false; ok: false; status: number; error: string };

export interface ModerationResult {
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  durationMs: number | null;
  labels: ModerationLabel[];
  statusMessage?: string;
}

export type GetResult = { disabled: true } | { disabled: false; ok: true; result: ModerationResult } | { disabled: false; ok: false; status: number; error: string };

export function rekognitionConfigFromEnv(): RekognitionConfig | null {
  const accessKeyId = readEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    region: readEnv("AWS_REGION") ?? "us-east-1",
    credentials: { accessKeyId, secretAccessKey, sessionToken: readEnv("AWS_SESSION_TOKEN") },
    snsTopicArn: readEnv("SCAN_SNS_TOPIC_ARN"),
    roleArn: readEnv("SCAN_SNS_ROLE_ARN"),
  };
}

async function call(config: RekognitionConfig, target: string, payload: unknown): Promise<Response> {
  const url = config.endpoint ?? `https://rekognition.${config.region}.amazonaws.com/`;
  const body = JSON.stringify(payload);
  const signed = await signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `RekognitionService.${target}` },
    body,
    service: "rekognition",
    region: config.region,
    credentials: config.credentials,
    includeContentSha: false,
  });
  const doFetch = config.fetch ?? fetch;
  return doFetch(url, { method: "POST", headers: signed.headers, body });
}

/** Starts StartContentModeration on s3://bucket/key. `clientToken` makes retries idempotent. */
export async function startContentModeration(
  config: RekognitionConfig | null,
  bucket: string,
  key: string,
  clientToken: string,
): Promise<StartResult> {
  if (!config) return { disabled: true };
  const payload: Record<string, unknown> = {
    Video: { S3Object: { Bucket: bucket, Name: key } },
    ClientRequestToken: clientToken.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64),
    MinConfidence: 50,
  };
  if (config.snsTopicArn && config.roleArn) {
    payload.NotificationChannel = { SNSTopicArn: config.snsTopicArn, RoleArn: config.roleArn };
  }
  const res = await call(config, "StartContentModeration", payload);
  if (!res.ok) return { disabled: false, ok: false, status: res.status, error: await res.text().catch(() => "") };
  const json = (await res.json()) as { JobId?: string };
  if (!json.JobId) return { disabled: false, ok: false, status: res.status, error: "no JobId" };
  return { disabled: false, ok: true, jobId: json.JobId };
}

interface GetContentModerationResponse {
  JobStatus?: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  StatusMessage?: string;
  VideoMetadata?: { DurationMillis?: number };
  ModerationLabels?: { ModerationLabel?: ModerationLabel }[];
  NextToken?: string;
}

/** Reads GetContentModeration, following NextToken so every label is seen. */
export async function getContentModeration(config: RekognitionConfig | null, jobId: string): Promise<GetResult> {
  if (!config) return { disabled: true };
  const labels: ModerationLabel[] = [];
  let next: string | undefined;
  let status: ModerationResult["status"] = "IN_PROGRESS";
  let durationMs: number | null = null;
  let statusMessage: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const payload: Record<string, unknown> = { JobId: jobId, MaxResults: 1000, SortBy: "TIMESTAMP" };
    if (next) payload.NextToken = next;
    const res = await call(config, "GetContentModeration", payload);
    if (!res.ok) return { disabled: false, ok: false, status: res.status, error: await res.text().catch(() => "") };
    const json = (await res.json()) as GetContentModerationResponse;
    status = json.JobStatus ?? "IN_PROGRESS";
    statusMessage = json.StatusMessage;
    if (typeof json.VideoMetadata?.DurationMillis === "number") durationMs = json.VideoMetadata.DurationMillis;
    for (const item of json.ModerationLabels ?? []) if (item.ModerationLabel) labels.push(item.ModerationLabel);
    next = json.NextToken;
    if (!next || status !== "SUCCEEDED") break;
  }
  return { disabled: false, ok: true, result: { status, durationMs, labels, statusMessage } };
}
