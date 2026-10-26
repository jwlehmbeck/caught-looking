/**
 * AWS Signature Version 4 with Web Crypto only (plan U11). Enough for the
 * S3 and Rekognition calls the scanners make; no SDK, so the same code runs
 * in Deno Edge Functions and in Node.
 *
 * `signRequest` returns the headers to send. `canonicalRequest` and
 * `stringToSign` are exported for the unit test, which checks a known AWS
 * test vector.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string | null;
  service: string;
  region: string;
  credentials: AwsCredentials;
  /** Overrides the clock (tests). */
  date?: Date;
  /** S3 wants x-amz-content-sha256 on every request; other services do not. */
  includeContentSha?: boolean;
  /** Send UNSIGNED-PAYLOAD instead of hashing the body (large S3 puts). */
  unsignedPayload?: boolean;
}

export interface SignedRequest {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const encoder = new TextEncoder();

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

function hex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = toBytes(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return hex(await crypto.subtle.digest("SHA-256", copy));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const keyCopy = new Uint8Array(keyBytes.byteLength);
  keyCopy.set(keyBytes);
  const cryptoKey = await crypto.subtle.importKey("raw", keyCopy, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

/** RFC 3986 encoding as AWS wants it (unreserved characters untouched). */
export function awsUriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += "/";
    else {
      for (const b of encoder.encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

export function amzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, key) => pairs.push([awsUriEncode(key), awsUriEncode(value)]));
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function canonicalPath(url: URL, service: string): string {
  const raw = url.pathname || "/";
  if (service === "s3") {
    // S3: encode once, keep slashes.
    return raw
      .split("/")
      .map((seg) => awsUriEncode(decodeURIComponentSafe(seg)))
      .join("/");
  }
  // Other services: normalize and encode each segment, then encode again.
  const segments = raw.split("/").map((seg) => awsUriEncode(awsUriEncode(decodeURIComponentSafe(seg))));
  return segments.join("/") || "/";
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), v.trim().replace(/\s+/g, " ")] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(""),
    signed: entries.map(([k]) => k).join(";"),
  };
}

export function canonicalRequest(
  method: string,
  url: URL,
  service: string,
  headers: Record<string, string>,
  payloadHash: string,
): { text: string; signedHeaders: string } {
  const { canonical, signed } = canonicalHeaders(headers);
  const text = [method.toUpperCase(), canonicalPath(url, service), canonicalQuery(url), canonical, signed, payloadHash].join("\n");
  return { text, signedHeaders: signed };
}

export function credentialScope(dateStamp: string, region: string, service: string): string {
  return `${dateStamp}/${region}/${service}/aws4_request`;
}

export async function stringToSign(amz: string, scope: string, canonical: string): Promise<string> {
  return ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n");
}

export async function signingKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export async function signRequest(input: SignInput): Promise<SignedRequest> {
  const url = new URL(input.url);
  const { amzDate: amz, dateStamp } = amzDate(input.date ?? new Date());
  const includeSha = input.includeContentSha ?? input.service === "s3";
  const payloadHash = input.unsignedPayload ? "UNSIGNED-PAYLOAD" : await sha256Hex(input.body ?? "");

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = url.host;
  headers["x-amz-date"] = amz;
  if (includeSha) headers["x-amz-content-sha256"] = payloadHash;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const { text: canonical, signedHeaders } = canonicalRequest(input.method, url, input.service, headers, payloadHash);
  const scope = credentialScope(dateStamp, input.region, input.service);
  const sts = await stringToSign(amz, scope, canonical);
  const key = await signingKey(input.credentials.secretAccessKey, dateStamp, input.region, input.service);
  const signature = hex(await hmac(key, sts));

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // `host` is set by fetch itself; sending it explicitly is rejected by some runtimes.
  const { host: _host, ...sendable } = headers;
  void _host;
  return { headers: sendable, canonicalRequest: canonical, stringToSign: sts, signature };
}
