"use server";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { validateUsername } from "@shared/filters/username.ts";

import { isOldEnough, parseBirthMonth } from "@/lib/auth/age";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  syntheticEmail,
  type CreateAccountState,
  type FormState,
} from "@/lib/auth/flow";
import { generateRecoveryCode, hashRecoveryCode } from "@/lib/auth/recovery-code";
import {
  AGE_BLOCK_COOKIE,
  AGE_OK_COOKIE,
  COOKIE_AGE_BLOCK,
  COOKIE_AGE_OK,
  COOKIE_SIGNUP,
  clearSignupCookies,
  field,
  readSignupCookies,
  verifyTurnstile,
  writeSignupProgress,
} from "@/lib/auth/server-helpers";
import {
  isPublicSignupOpen,
  loadUsernameSets,
  nextStep,
} from "@/lib/auth/signup-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const USERNAME_TAKEN = "That username isn't available.";
const TRY_AGAIN = "Something went wrong. Try again.";

function stepUrl(step: string): string {
  return `/signup?step=${step}`;
}

/**
 * Step 1: the neutral age screen. Under 13 → a one-year device flag and the
 * generic screen; nothing about the answer is stored anywhere else. 13 or
 * older → the birth year in a one-hour cookie and on to the next step.
 */
export async function submitAge(_prev: FormState, formData: FormData): Promise<FormState> {
  const store = await cookies();
  if (store.get(COOKIE_AGE_BLOCK)?.value === "1") redirect("/signup");

  const birth = parseBirthMonth(formData.get("month"), formData.get("year"));
  if (!birth) return { error: "Pick your birth month and year." };

  if (!isOldEnough(birth)) {
    store.set(COOKIE_AGE_BLOCK, "1", AGE_BLOCK_COOKIE);
    store.delete(COOKIE_AGE_OK);
    store.delete(COOKIE_SIGNUP);
    redirect("/signup");
  }

  store.set(COOKIE_AGE_OK, String(birth.year), AGE_OK_COOKIE);
  store.delete(COOKIE_SIGNUP);
  redirect(stepUrl(nextStep("age", await isPublicSignupOpen())));
}

/** Step 2: invite code (dry-run check; the use is counted when the account is made). */
export async function submitInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const { blocked, birthYear, progress } = await readSignupCookies();
  if (blocked) redirect("/signup");
  if (!birthYear) redirect(stepUrl("age"));

  const code = field(formData, "invite").trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return { error: "That invite code isn't valid." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("redeem_invite_code", { p_code: code, p_consume: false });
  if (error || data !== true) return { error: "That invite code isn't valid." };

  await writeSignupProgress({ ...progress, invite: code });
  redirect(stepUrl("rules"));
}

/** Step 3: house rules and terms must be ticked. */
export async function submitRules(_prev: FormState, formData: FormData): Promise<FormState> {
  const { blocked, birthYear, progress } = await readSignupCookies();
  if (blocked) redirect("/signup");
  if (!birthYear) redirect(stepUrl("age"));
  const publicOpen = await isPublicSignupOpen();
  if (!publicOpen && !progress?.invite) redirect(stepUrl("invite"));

  if (formData.get("accept") !== "on") {
    return { error: "You need to agree to the house rules and terms to continue." };
  }
  await writeSignupProgress({ ...progress, rules: true });
  redirect(stepUrl("username"));
}

/** Step 4: username through the filter pipeline plus the database's own check. */
export async function submitUsername(_prev: FormState, formData: FormData): Promise<FormState> {
  const { blocked, birthYear, progress } = await readSignupCookies();
  if (blocked) redirect("/signup");
  if (!birthYear) redirect(stepUrl("age"));
  if (!progress?.rules) redirect(stepUrl("rules"));

  const username = field(formData, "username").trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return { error: "Use 3 to 20 letters, numbers or underscores." };
  }

  let sets: { reserved: Set<string>; held: Set<string> };
  try {
    sets = await loadUsernameSets();
  } catch {
    return { error: TRY_AGAIN };
  }
  const check = validateUsername(username, sets);
  if (!check.ok) return { error: USERNAME_TAKEN };

  const admin = createAdminClient();
  const { data: available, error } = await admin.rpc("username_available", { p_normalized: check.normalized });
  if (error) return { error: TRY_AGAIN };
  if (available !== true) return { error: USERNAME_TAKEN };

  await writeSignupProgress({ ...progress, username });
  redirect(stepUrl("team"));
}

/** Step 5: favorite team, one of the 30. */
export async function submitTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const { blocked, birthYear, progress } = await readSignupCookies();
  if (blocked) redirect("/signup");
  if (!birthYear) redirect(stepUrl("age"));
  if (!progress?.username) redirect(stepUrl("username"));

  const team = Number(field(formData, "team"));
  if (!Number.isInteger(team) || team < 1) return { error: "Pick a team." };

  const admin = createAdminClient();
  const { data } = await admin.from("teams").select("id").eq("id", team).maybeSingle();
  if (!data) return { error: "Pick a team." };

  await writeSignupProgress({ ...progress, team });
  redirect(stepUrl("password"));
}

/**
 * Final step: password, then the account. Order matters: every cheap check
 * first, the invite use counted, the auth user created with our own UUID,
 * the profile in one database transaction (auth user deleted again if that
 * fails), the recovery code stored hashed, then sign-in. The plain code is
 * returned exactly once.
 */
export async function createAccount(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const fail = (error: string): CreateAccountState => ({ error, recoveryCode: null, username: null });

  const { blocked, birthYear, progress } = await readSignupCookies();
  if (blocked) redirect("/signup");
  if (!birthYear) redirect(stepUrl("age"));
  if (!progress?.rules) redirect(stepUrl("rules"));
  if (!progress.username) redirect(stepUrl("username"));
  if (!progress.team) redirect(stepUrl("team"));

  const publicOpen = await isPublicSignupOpen();
  if (!publicOpen && !progress.invite) redirect(stepUrl("invite"));

  const password = field(formData, "password");
  const confirm = field(formData, "confirm");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail(`Your password can be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirm) return fail("Those passwords don't match.");

  if (!(await verifyTurnstile(formData.get("cf-turnstile-response")))) {
    return fail("The bot check didn't pass. Try again.");
  }

  // Username: run the filter again in case the lists changed since step 4.
  let sets: { reserved: Set<string>; held: Set<string> };
  try {
    sets = await loadUsernameSets();
  } catch {
    return fail(TRY_AGAIN);
  }
  const check = validateUsername(progress.username, sets);
  if (!check.ok) {
    await writeSignupProgress({ ...progress, username: undefined, team: undefined });
    redirect(`${stepUrl("username")}&retry=1`);
  }

  const admin = createAdminClient();

  // Count the invite use now. A later failure wastes one use, which is the
  // safer direction: nobody gets an account without an invite.
  const inviteRes = await admin.rpc("redeem_invite_code", {
    p_code: publicOpen ? (progress.invite ?? null) : progress.invite,
    p_consume: true,
  });
  if (inviteRes.error || inviteRes.data !== true) {
    await writeSignupProgress({ ...progress, invite: undefined });
    redirect(`${stepUrl("invite")}&retry=1`);
  }

  const userId = randomUUID();
  const created = await admin.auth.admin.createUser({
    id: userId,
    email: syntheticEmail(userId),
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    console.error("createUser failed", created.error?.message);
    return fail(TRY_AGAIN);
  }

  const profileRes = await admin.rpc("signup_create_profile", {
    p_user_id: userId,
    p_username: progress.username,
    p_normalized: check.normalized,
    p_team: progress.team,
    p_birth_year: birthYear,
  });
  if (profileRes.error) {
    await admin.auth.admin.deleteUser(userId);
    if (profileRes.error.code === "23505" || profileRes.error.code === "P0001") {
      await writeSignupProgress({ ...progress, username: undefined, team: undefined });
      redirect(`${stepUrl("username")}&retry=1`);
    }
    console.error("signup_create_profile failed", profileRes.error.message);
    return fail(TRY_AGAIN);
  }

  const recoveryCode = generateRecoveryCode();
  const codeRes = await admin.rpc("set_recovery_code", {
    p_user_id: userId,
    p_code_hash: await hashRecoveryCode(recoveryCode),
  });
  if (codeRes.error) {
    // The account exists; the user can regenerate a code from settings.
    console.error("set_recovery_code failed", codeRes.error.message);
  }

  const supabase = await createClient();
  const signIn = await supabase.auth.signInWithPassword({ email: syntheticEmail(userId), password });
  if (signIn.error) {
    console.error("post-signup sign-in failed", signIn.error.message);
    await clearSignupCookies();
    redirect("/login?created=1");
  }

  await clearSignupCookies();
  return { error: null, recoveryCode, username: progress.username };
}
