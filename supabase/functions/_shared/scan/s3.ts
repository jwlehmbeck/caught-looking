/**
 * Minimal S3 client for the short-retention scan bucket (plan U11): put and
 * delete one object, signed with SigV4. No SDK.
 *
 * Disabled mode: when AWS_ACCESS_KEY_ID (or the bucket) is unset every call
 * returns `{ disabled: true }` and nothing leaves the machine, so the app
 * works locally. Wire the real bucket by setting the env in .env.example's
 * "Scanning (optional locally)" section.
 */
import { readEnv } from "../alerts/index.ts";
import { signRequest, type AwsCredentials } from "./sigv4.ts";

export interface S3Config {
  region: string;
  bucket: string;
  credentials: AwsCredentials;
  /** Override the endpoint (tests, S3-compatible stores). */
  endpoint?: string;
  fetch?: typeof fetch;
}

export type S3Result = { disabled: true } | { disabled: false; ok: boolean; status: number };

export function s3ConfigFromEnv(): S3Config | null {
  const accessKeyId = readEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("AWS_SECRET_ACCESS_KEY");
  const bucket = readEnv("SCAN_S3_BUCKET");
  const region = readEnv("AWS_REGION") ?? "us-east-1";
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  return { region, bucket, credentials: { accessKeyId, secretAccessKey, sessionToken: readEnv("AWS_SESSION_TOKEN") } };
}

export function objectUrl(config: S3Config, key: string): string {
  const base = config.endpoint ?? `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return config.endpoint ? `${base}/${config.bucket}/${encodedKey}` : `${base}/${encodedKey}`;
}

export async function putObject(
  config: S3Config | null,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<S3Result> {
  if (!config) return { disabled: true };
  const url = objectUrl(config, key);
  const signed = await signRequest({
    method: "PUT",
    url,
    headers: { "content-type": contentType, "content-length": String(body.byteLength) },
    body,
    service: "s3",
    region: config.region,
    credentials: config.credentials,
  });
  const doFetch = config.fetch ?? fetch;
  const res = await doFetch(url, { method: "PUT", headers: signed.headers, body: body as BodyInit });
  return { disabled: false, ok: res.ok, status: res.status };
}

export async function deleteObject(config: S3Config | null, key: string): Promise<S3Result> {
  if (!config) return { disabled: true };
  const url = objectUrl(config, key);
  const signed = await signRequest({
    method: "DELETE",
    url,
    service: "s3",
    region: config.region,
    credentials: config.credentials,
  });
  const doFetch = config.fetch ?? fetch;
  const res = await doFetch(url, { method: "DELETE", headers: signed.headers });
  return { disabled: false, ok: res.ok, status: res.status };
}
