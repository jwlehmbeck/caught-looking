import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseEnv } from "./env";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Use `getClaims()` for authorization decisions (verified locally against the
 * project's signing keys). Reach for `getUser()` only when the fresh user
 * record is needed, and never trust `getSession()` on the server.
 *
 * Routes that use this client must never be cached by ISR or a CDN: a cached
 * Set-Cookie could sign one user in as another.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session on the next request instead.
        }
      },
    },
  });
}
