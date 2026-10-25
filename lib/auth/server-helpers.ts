import "server-only";

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import { cookies, headers } from "next/headers";

/**
 * Cookie names used by the signup flow. All httpOnly; the browser never reads
 * them. Nothing here is ever written to localStorage.
 */
export const COOKIE_AGE_BLOCK = "cl_age_block"; // "1" for a year after an under-13 answer
export const COOKIE_AGE_OK = "cl_age_ok"; // the birth year, for one hour
export const COOKIE_SIGNUP = "cl_su"; // signed JSON of completed step values

const HOUR = 60 * 60;
const YEAR = 365 * 24 * HOUR;

function baseCookie(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export const AGE_BLOCK_COOKIE = baseCookie(YEAR);
export const AGE_OK_COOKIE = baseCookie(HOUR);
export const SIGNUP_COOKIE = baseCookie(HOUR);

// --- Signed signup state ---------------------------------------------------

export interface SignupProgress {
  invite?: string;
  rules?: true;
  username?: string;
  team?: number;
  /** Unix seconds after which the cookie is ignored. */
  exp: number;
}

function signingKey(): Buffer {
  const secret = process.env.AUTH_COOKIE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Set AUTH_COOKIE_SECRET (or SUPABASE_SERVICE_ROLE_KEY) so signup state can be signed.");
  }
  return createHash("sha256").update(`caught-looking-signup:${secret}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function encodeSignupProgress(progress: SignupProgress): string {
  const payload = Buffer.from(JSON.stringify(progress), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSignupProgress(raw: string | undefined): SignupProgress | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignupProgress;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Reads every piece of signup state from the request cookies. */
export async function readSignupCookies() {
  const store = await cookies();
  const blocked = store.get(COOKIE_AGE_BLOCK)?.value === "1";
  const birthYearRaw = Number(store.get(COOKIE_AGE_OK)?.value);
  const birthYear = Number.isInteger(birthYearRaw) && birthYearRaw > 1800 ? birthYearRaw : null;
  const progress = decodeSignupProgress(store.get(COOKIE_SIGNUP)?.value);
  return { blocked, birthYear, progress };
}

export async function writeSignupProgress(progress: Omit<SignupProgress, "exp">) {
  const store = await cookies();
  store.set(COOKIE_SIGNUP, encodeSignupProgress({ ...progress, exp: Math.floor(Date.now() / 1000) + HOUR }), SIGNUP_COOKIE);
}

export async function clearSignupCookies() {
  const store = await cookies();
  store.delete(COOKIE_SIGNUP);
  store.delete(COOKIE_AGE_OK);
}

// --- Request context -------------------------------------------------------

/** Best-effort client IP from the usual proxy headers. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? "unknown";
}

/** Hashed with a server secret so the raw IP never lands in the database. */
export async function clientIpHash(): Promise<string> {
  const ip = await clientIp();
  return createHmac("sha256", signingKey()).update(`ip:${ip}`).digest("hex");
}

// --- Turnstile --------------------------------------------------------------

/**
 * Verifies a Cloudflare Turnstile token. When TURNSTILE_SECRET_KEY is not
 * set (local dev, CI) it passes with a warning so the flow stays usable.
 */
export async function verifyTurnstile(token: FormDataEntryValue | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("TURNSTILE_SECRET_KEY is not set; bot check skipped.");
    return true;
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: await clientIp() });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

// --- Form helpers -----------------------------------------------------------

export function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
