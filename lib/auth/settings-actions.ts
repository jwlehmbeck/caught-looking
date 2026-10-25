"use server";

import { redirect } from "next/navigation";

import { type FormState, type RegenerateState } from "@/lib/auth/flow";
import { generateRecoveryCode, hashRecoveryCode } from "@/lib/auth/recovery-code";
import { field } from "@/lib/auth/server-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/**
 * Makes a new recovery code for the signed-in user and retires the old one.
 * The plain code is returned once; only its bcrypt hash is stored.
 */
export async function regenerateRecoveryCode(): Promise<RegenerateState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const recoveryCode = generateRecoveryCode();
  const admin = createAdminClient();
  const { error } = await admin.rpc("auth_set_recovery_code", {
    p_user_id: userId,
    p_code_hash: await hashRecoveryCode(recoveryCode),
  });
  if (error) {
    console.error("set_recovery_code failed", error.message);
    return { error: "Couldn't make a new code. Try again.", recoveryCode: null };
  }
  return { error: null, recoveryCode };
}

/**
 * Deletes the signed-in user's account. The database tombstones the profile
 * and anonymizes or holds the content (public.delete_account); then the auth
 * user goes, so the account can never sign in again.
 */
export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  if (field(formData, "confirm_word").trim().toUpperCase() !== "DELETE") {
    return { error: 'Type DELETE to confirm.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_account");
  if (error) {
    console.error("delete_account failed", error.message);
    return { error: "Couldn't delete the account. Try again." };
  }

  const admin = createAdminClient();
  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) {
    // The profile is already tombstoned; log it so an admin can finish the job.
    console.error("auth deleteUser failed", removed.error.message);
  }

  await supabase.auth.signOut();
  redirect("/signup?deleted=1");
}
