import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "./env";

/**
 * Browser-side Supabase client.
 *
 * Client roles can only read (plan: "Client roles can only read; every write
 * goes through a checked server path"). Never use this client to write
 * content or to sign users up; signup and login are server actions.
 */
export function createClient() {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient(url, publishableKey);
}
