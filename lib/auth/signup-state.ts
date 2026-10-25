import "server-only";

import { SIGNUP_STEPS, type SignupStep } from "@/lib/auth/flow";
import { readSignupCookies, type SignupProgress } from "@/lib/auth/server-helpers";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SignupStatus {
  blocked: boolean;
  publicOpen: boolean;
  birthYear: number | null;
  progress: SignupProgress | null;
  /** The furthest step the visitor may open given what they have completed. */
  furthest: SignupStep;
}

/** Is the invite-code step skipped? Read once per request from app_settings. */
export async function isPublicSignupOpen(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", "public_signup_open").maybeSingle();
    return data?.value === true;
  } catch {
    return false;
  }
}

/** Which step the visitor has earned, from cookies alone (no database writes). */
export function furthestStep(
  birthYear: number | null,
  progress: SignupProgress | null,
  publicOpen: boolean,
): SignupStep {
  if (!birthYear) return "age";
  if (!publicOpen && !progress?.invite) return "invite";
  if (!progress?.rules) return "rules";
  if (!progress.username) return "username";
  if (!progress.team) return "team";
  return "password";
}

export function stepIndex(step: SignupStep): number {
  return SIGNUP_STEPS.indexOf(step);
}

export async function readSignupStatus(): Promise<SignupStatus> {
  const [{ blocked, birthYear, progress }, publicOpen] = await Promise.all([
    readSignupCookies(),
    isPublicSignupOpen(),
  ]);
  return {
    blocked,
    publicOpen,
    birthYear,
    progress,
    furthest: furthestStep(birthYear, progress, publicOpen),
  };
}

/** The step after `step`, skipping the invite step when signup is public. */
export function nextStep(step: SignupStep, publicOpen: boolean): SignupStep {
  let i = stepIndex(step) + 1;
  if (SIGNUP_STEPS[i] === "invite" && publicOpen) i += 1;
  return SIGNUP_STEPS[Math.min(i, SIGNUP_STEPS.length - 1)];
}

/** Reserved and held names, normalized, for the username filter. */
export async function loadUsernameSets(): Promise<{ reserved: Set<string>; held: Set<string> }> {
  const admin = createAdminClient();
  const [reservedRes, heldRes] = await Promise.all([
    admin.from("reserved_usernames").select("normalized"),
    admin.from("username_holds").select("normalized_username").gt("released_at", new Date().toISOString()),
  ]);
  if (reservedRes.error) throw reservedRes.error;
  if (heldRes.error) throw heldRes.error;
  return {
    reserved: new Set((reservedRes.data ?? []).map((r: { normalized: string }) => r.normalized)),
    held: new Set((heldRes.data ?? []).map((r: { normalized_username: string }) => r.normalized_username)),
  };
}
