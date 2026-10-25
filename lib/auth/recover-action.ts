"use server";

import { normalizeUsername } from "@shared/filters/username.ts";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  syntheticEmail,
  type RecoverState,
} from "@/lib/auth/flow";
import {
  compareRecoveryCode,
  dummyRecoveryHash,
  generateRecoveryCode,
  hashRecoveryCode,
} from "@/lib/auth/recovery-code";
import { clientIpHash, field, verifyTurnstile } from "@/lib/auth/server-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const NO_MATCH =
  "That didn't work. Check the username and recovery code. After several tries, wait an hour before trying again.";
const TOO_MANY = "Too many tries from this connection. Wait an hour and try again.";

interface RecoveryRow {
  user_id: string;
  code_hash: string | null;
  locked: boolean;
}

/**
 * Username + recovery code + new password. Throttled per IP (5/hour) and
 * per username (5 wrong codes lock recovery for an hour). On success the
 * password changes, every other session is signed out, a fresh recovery
 * code is issued and shown once, and this device is signed in.
 */
export async function recoverAccount(_prev: RecoverState, formData: FormData): Promise<RecoverState> {
  const fail = (error: string): RecoverState => ({ error, recoveryCode: null });

  const username = field(formData, "username").trim();
  const code = field(formData, "code");
  const password = field(formData, "password");
  const confirm = field(formData, "confirm");

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || code.trim().length === 0) return fail(NO_MATCH);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail(`Your password can be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirm) return fail("Those passwords don't match.");
  if (!(await verifyTurnstile(formData.get("cf-turnstile-response")))) {
    return fail("The bot check didn't pass. Try again.");
  }

  const admin = createAdminClient();

  const ipRes = await admin.rpc("recovery_ip_allowed", { p_ip_hash: await clientIpHash() });
  if (ipRes.error) return fail("Something went wrong. Try again.");
  if (ipRes.data !== true) return fail(TOO_MANY);

  const { data, error } = await admin.rpc("get_recovery_hash", {
    p_normalized_username: normalizeUsername(username),
  });
  const row = Array.isArray(data) ? (data[0] as RecoveryRow | undefined) : undefined;
  if (error || !row) {
    await compareRecoveryCode(code, dummyRecoveryHash());
    return fail(NO_MATCH);
  }

  const ok = row.code_hash !== null && !row.locked && (await compareRecoveryCode(code, row.code_hash));
  if (!ok && row.code_hash === null) await compareRecoveryCode(code, dummyRecoveryHash());

  const recorded = await admin.rpc("record_recovery_result", { p_user_id: row.user_id, p_ok: ok });
  if (recorded.error) return fail("Something went wrong. Try again.");
  // A correct code during a lock is still refused by the database.
  if (!ok || recorded.data === true) return fail(NO_MATCH);

  const updated = await admin.auth.admin.updateUserById(row.user_id, { password });
  if (updated.error) {
    console.error("recovery password update failed", updated.error.message);
    return fail("Something went wrong. Try again.");
  }

  const supabase = await createClient();
  const signIn = await supabase.auth.signInWithPassword({
    email: syntheticEmail(row.user_id),
    password,
  });
  if (signIn.error || !signIn.data.session) {
    console.error("post-recovery sign-in failed", signIn.error?.message);
    return fail("Your password was changed. Sign in with it from the login page.");
  }

  // Sign out every other device; this new session stays.
  const revoked = await admin.auth.admin.signOut(signIn.data.session.access_token, "others");
  if (revoked.error) console.error("session revoke failed", revoked.error.message);

  const recoveryCode = generateRecoveryCode();
  const stored = await admin.rpc("set_recovery_code", {
    p_user_id: row.user_id,
    p_code_hash: await hashRecoveryCode(recoveryCode),
  });
  if (stored.error) {
    console.error("set_recovery_code failed", stored.error.message);
    return fail("Your password was changed, but a new recovery code couldn't be made. Make one in settings.");
  }

  return { error: null, recoveryCode };
}
