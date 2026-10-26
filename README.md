# Caught Looking

A hangout for teen baseball fans: pick winners, earn badges, watch clips, talk ball.

The plan lives in `docs/plans/2026-10-21-001-feat-caught-looking-v1-plan.md`.

## Setup

You need Node 22, Docker Desktop (running), and npm.

```bash
npm install
npm run db:start        # starts local Supabase; prints the API URL and keys
cp .env.example .env.local
# paste the API URL and the publishable (anon) key from db:start into .env.local
npm run dev             # http://localhost:3000
```

## Tests

| Command            | What it checks                                        |
| ------------------ | ----------------------------------------------------- |
| `npm test`         | Unit tests (Vitest): domain rules, filters, helpers   |
| `npm run test:db`  | Database tests (pgTAP): RLS, triggers, RPC rules      |
| `npm run test:e2e` | Browser tests (Playwright) at phone width             |
| `npm run test:all` | Typecheck, lint, then all three suites                |

`npm run test:db` needs the local Supabase stack running (`npm run db:start`).
If Playwright hasn't downloaded a browser yet: `npx playwright install chromium`.

## Where things live

- `app/` — Next.js routes and screens
- `lib/supabase/` — browser and server Supabase clients; `proxy.ts` refreshes sessions
- `supabase/functions/_shared/` — runtime-neutral domain code used by both the app and Edge Functions
- `supabase/migrations/`, `supabase/tests/` — schema and pgTAP tests
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/mlb/` — Vitest, Playwright, recorded MLB data

## Before launch

Caught Looking runs invite-only until every gate passes. `public_signup_open`
stays `false` until then.

- `docs/launch-checklist.md` — every launch gate (legal, data, safety,
  infrastructure, product) with an adult-admin sign-off line.
- `docs/ops/runbook.md` — deploying, creating the first admin, invite codes,
  alerts and secret rotation.

## Policies

Public pages: `/rules`, `/terms`, `/privacy`, `/child-safety`, `/contact`
(terms and privacy are drafts pending legal review).

- `docs/policies/mod-handbook.md` — roles, response targets, sanctions, appeals
- `docs/policies/csam-procedure.md` — quarantine, ban, NCMEC report, preservation
- `docs/policies/upload-rules.md` — fan edit rules and the review flow
- `docs/policies/data-retention.md` — what we keep, how long, how it's deleted
- `docs/policies/security-program.md` — secrets inventory, rotation, access, annual review
- `docs/policies/dmca.md` — designated agent, takedowns, counter-notices, repeat infringers

Not affiliated with MLB or any club.
