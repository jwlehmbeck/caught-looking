<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Caught Looking project rules

- The plan in `docs/plans/` is the source of truth for scope and decisions. Read the relevant unit before building it.
- **Writes never go through the browser client.** Authenticated users get SELECT only; every write is a `security definer` RPC or a service-role Edge Function that runs the filter and limit checks. Public Supabase signups are disabled; signup and login are server actions.
- `cacheComponents` stays off. Never cache an authenticated response.
- Runtime-neutral domain code (game state, scoring, badges, filters, MLB adapter) lives in `supabase/functions/_shared/` and is imported as `@shared/...` with a `.ts` extension. No Next, React or Node imports in there.
- The service-role key, AWS and OpenAI keys are server-only. Never give a secret a `NEXT_PUBLIC_` prefix.
- Phone-first (390 px). Touch targets at least 44 px, text contrast at least 4.5:1, team identity never by color alone.
- Every feature-bearing change ships with tests: Vitest for rules, pgTAP for database policies, Playwright for screens.
- Every new table ends with `select private.lock_down('public.<table>');` and, if members may read it, `grant select ... to authenticated;`. New `private` functions get `revoke all ... from public, anon, authenticated` unless a policy needs them.
- pgTAP tests use the `tests.*` helpers (`create_user`, `authenticate_as`, `create_game`). Each file is `begin; ... rollback;`.
