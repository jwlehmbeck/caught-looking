import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Server code only: it bypasses RLS and can
 * call the `private.*` functions that signup, login and recovery use.
 *
 * The key comes from SUPABASE_SERVICE_ROLE_KEY and must never be given a
 * NEXT_PUBLIC_ prefix or imported from a client component (the `server-only`
 * import above turns that mistake into a build error).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Server actions that create or recover accounts need both.",
    );
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
