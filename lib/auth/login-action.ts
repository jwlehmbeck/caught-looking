"use server";

import { redirect } from "next/navigation";

import { normalizeUsername } from "@shared/filters/username.ts";

import { syntheticEmail, type FormState } from "@/lib/auth/flow";
import { field, verifyTurnstile } from "@/lib/auth/server-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const NO_MATCH = "That username and password don't match.";

interface SanctionRow {
  kind: string;
  reason: string;
  ends_at: string | null;
}

/** The user's active ban, if any. Read with the service role so it cannot be hidden. */
async function activeBan(userId: string): Promise<SanctionRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sanctions")
    .select("kind, reason, ends_at")
    .eq("user_id", userId)
    .eq("kind", "ban")
    .is("lifted_at", null)
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  return (data as SanctionRow | null) ?? null;
}

/**
 * Username + password → session cookie. The username-to-id lookup happens
 * with the service role, so the mapping never reaches the browser. Banned
 * users are signed straight back out with the reason and the appeal path;
 * suspended and muted users get in and see a banner.
 */
export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = field(formData, "username").trim();
  const password = field(formData, "password");
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || password.length === 0) {
    return { error: NO_MATCH };
  }
  if (!(await verifyTurnstile(formData.get("cf-turnstile-response")))) {
    return { error: "The bot check didn't pass. Try again." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("auth_lookup_login", {
    p_normalized_username: normalizeUsername(username),
  });
  const row = Array.isArray(data) ? (data[0] as { user_id: string } | undefined) : undefined;
  if (error || !row) return { error: NO_MATCH };

  const supabase = await createClient();
  const signIn = await supabase.auth.signInWithPassword({
    email: syntheticEmail(row.user_id),
    password,
  });
  if (signIn.error) return { error: NO_MATCH };

  const ban = await activeBan(row.user_id);
  if (ban) {
    await supabase.auth.signOut();
    const until = ban.ends_at ? ` until ${new Date(ban.ends_at).toLocaleDateString("en-US")}` : "";
    return {
      error: `This account is banned${until}. Reason: ${ban.reason}. If you think that's a mistake, you can appeal at /contact.`,
    };
  }

  redirect("/");
}

/** Signs the current session out and returns to login. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
