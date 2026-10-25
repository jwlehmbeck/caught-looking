/**
 * Reads the two public Supabase settings and fails loudly when they are missing,
 * so a misconfigured deploy breaks at startup instead of at first request.
 *
 * Only the URL and the publishable key may ever carry the NEXT_PUBLIC_ prefix.
 * The service-role key is server-only and lives in SUPABASE_SERVICE_ROLE_KEY.
 */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and run `npm run db:start` to get local values.",
    );
  }
  return { url, publishableKey };
}
