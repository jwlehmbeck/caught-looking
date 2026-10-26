# Launch checklist

Every gate that must pass before Caught Looking opens beyond the private,
invite-only test group. Sources: plan U14, the Risk table, "Assumptions
Requiring Owner Confirmation" and "Deferred / Open Questions" in
`docs/plans/2026-10-21-001-feat-caught-looking-v1-plan.md`.

**`public_signup_open` stays `false` in `app_settings` until every box below
is checked and signed.** The private test may start once the items marked
*(private test)* are done.

How to do most of these: `docs/ops/runbook.md`.

## Legal

- [ ] Lawyer review of the terms of use (`/terms`), then remove the "Draft — pending legal review" notice.
- [ ] Lawyer review of the privacy notice (`/privacy`), then remove the draft notice.
- [ ] Lawyer review of the age gate (neutral age screen, no-retry flag, birth year only).
- [ ] Lawyer review of Florida HB 3 "addictive feature" exposure (visible vote counts, live chat) — ideally before U6/U10 UI locks.
- [ ] Lawyer review of other state teen social-media and age-assurance laws (e.g. Utah, Texas, Louisiana, California AADC) and the amended COPPA Rule.
- [ ] Lawyer review of the child-safety procedure (`docs/policies/csam-procedure.md`), including who may view flagged material.
- [ ] Lawyer confirms DMCA counter-notice handling for minors (`docs/policies/dmca.md` §3).
- [ ] DMCA designated agent registered with the US Copyright Office ($6, renews every 3 years); renewal date on the calendar.
- [ ] `[DMCA AGENT NAME/ADDRESS]` replaced on `/terms` and `/contact` (`components/policy-page.tsx`).
- [ ] Contact email set up and monitored; `[CONTACT EMAIL]` replaced everywhere (`components/policy-page.tsx`, `docs/policies/*`). *(private test)*
- [ ] Policy pages' "Last updated" date bumped after legal edits.

## Data

- [ ] MLB data decision made: written MLBAM permission **or** a licensed provider (Sportradar, SportsDataIO, MySportsFeeds) wired behind the U4 adapter, with the id-mapping migration done.
- [ ] If switching providers: confirm highlight links still work or the highlight cards are hidden.
- [ ] No MLB or club logos, and no "MLB" or club names in the app name, icon or store screenshots.
- [ ] Storage purge worker built for `public.deletion_queue` (or a weekly manual purge in the runbook), never touching quarantine.
- [ ] Yearly pruning job (or quarterly manual SQL) for `mod_actions`, `sanctions`, `alert_log`, closed `reports`, released `username_holds` — per `docs/policies/data-retention.md`.
- [ ] Data retention policy re-checked against `private.delete_user_data`.

## Safety

- [ ] At least **two adult admins** named and trained on `docs/policies/mod-handbook.md` and `docs/policies/csam-procedure.md`. Second admin: ______________
- [ ] MFA for admins and mods decided (open decision); if yes, built and enforced.
- [ ] CSAM hash-matching service chosen (Thorn Safer or Google CSAI Match), agreement signed, account approved, `CSAM_SERVICE_URL` / `CSAM_SERVICE_KEY` set, and a test match lands in quarantine.
- [ ] Named admin registered with NCMEC for CyberTipline reporting.
- [ ] Safety drill run on **test content**: urgent report alert → admin first look within 12 h; under-13 report → deletion; simulated hash match → quarantine, ban, CyberTipline steps walked through (without filing); mod hide → appeal.
- [ ] Fan mods: decide whether any are appointed, and write who qualifies (plan open question).
- [ ] Rate limits beyond chat and uploads (comments, posts, votes, poll votes, login) decided or built (plan open question).
- [ ] Crisis lines (988, Crisis Text Line HOME to 741741) shown on the report sheet and `/child-safety`. *(private test)*

## Infrastructure

- [ ] Supabase **Pro** plan (50 MB file cap, idle pausing and 200-connection Realtime limit on Free). *(private test)*
- [ ] All migrations applied (`supabase db push`) and every Edge Function deployed. *(private test)*
- [ ] Vault secrets created and verified: *(private test)*
  - [ ] `poll_games_url`
  - [ ] `score_games_url`
  - [ ] `ingest_news_url`
  - [ ] `scan_sweep_url`
  - [ ] `scan_upload_url`
  - [ ] `internal_function_secret`
- [ ] Cron schedules present in `cron.job` and running: `poll-games`, `score-games`, `ingest-news`, `scan-sweep` (check `cron.job_run_details`). *(private test)*
- [ ] Storage webhook on `storage.objects` INSERT (bucket `uploads`) → `scan-upload` with the `x-internal-secret` header. *(private test)*
- [ ] `INTERNAL_FUNCTION_SECRET` set in function secrets, Vault and host env (same value). *(private test)*
- [ ] `OPENAI_API_KEY` set — moderation fails closed without it, so chat messages get held. *(private test)*
- [ ] Turnstile keys set (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). *(private test)*
- [ ] `AUTH_COOKIE_SECRET` set in the host env. *(private test)*
- [ ] AWS scanning: IAM user scoped to scan bucket + Rekognition, S3 bucket with 1-day lifecycle, SNS topic + role, SNS HTTPS subscription to `scan-complete`; keys set; a test clip scans end to end.
- [ ] `ADMIN_ALERT_WEBHOOK_URL` set and a test alert reaches the admin's email/phone. *(private test)*
- [ ] Secrets inventory in `docs/policies/security-program.md` matches what's deployed; no secret has a `NEXT_PUBLIC_` prefix except URL, publishable key and Turnstile site key.
- [ ] CI secret scan (gitleaks) green on `main`.
- [ ] **300-concurrent-subscriber chat load test** passes (every message delivered, no Realtime limit errors).
- [ ] Supabase usage alerts set (storage, egress, Realtime connections).

## Product

- [ ] Invite codes generated for the private group (mod console → Invites). *(private test)*
- [ ] Signup cannot finish without accepting the house rules and terms (Playwright `signup.spec.ts`).
- [ ] Every policy page reachable from signup, settings and home (Playwright `policy-pages.spec.ts`).
- [ ] Private test go/no-go decision held after the test (plan: path to public launch, priced gates).
- [ ] Thresholds for small groups decided (Upset Special 20 pickers, fan-base board 5 per team, per-game chat rooms).
- [ ] App Review notes drafted for the later mobile build: "Free. No prizes, no money, no betting, no purchases. Picks are for bragging rights only. Not affiliated with MLB." Plus a demo account and the moderation summary.
- [ ] `public_signup_open` flipped to `true` — **last**, only after everything above is signed.

## Sign-off

Signed off by (adult admin): ______________________________ Date: ____________

Second adult admin: ______________________________ Date: ____________
