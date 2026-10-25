# _shared

Runtime-neutral TypeScript used by both the Next.js app and Supabase Edge
Functions (Deno): game state, scoring, badges, leaderboard rules, content
filters, the MLB provider adapter and admin alerts.

Rules:

- No imports from `next`, `react`, Node built-ins or anything under `lib/`.
- Relative imports inside this folder must include the `.ts` extension, which
  Deno requires and the Next build tolerates.
- Next imports it through the `@shared/*` path alias.
