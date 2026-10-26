# Security program

How Caught Looking protects its secrets, admin access and members' data.
Reviewed every year (next review **2027-10-25**) and after any incident.

Last updated: 2026-10-25. Owner: the adult admin (Jason).

## Rules that never bend

- The **service-role key never reaches a browser**. It is created only in
  server code (`lib/supabase/admin.ts`) and Edge Functions.
- Only two values may carry a `NEXT_PUBLIC_` prefix:
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (plus the Turnstile **site** key, which is public by design). Everything
  else is server-only.
- **Local and production keys are separate.** Local development uses the
  keys `supabase start` prints and leaves optional scanners unset. Production
  keys exist only in the production Supabase project, the host's production
  environment and CI secrets; they are never copied into `.env.local`, chat,
  email, tickets or screenshots.
- Real secrets are never committed. `.env.local` is gitignored, and CI runs a
  gitleaks secret scan on every push and pull request before any other job
  (`.github/workflows/ci.yml`).

## Secrets inventory

| Secret | Used by | Lives in (production) | Notes |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Next server actions, Edge Functions | Host env (server only); Supabase sets it for functions automatically | Bypasses RLS. Highest value. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon) | Browser and server clients | Host env | Public by design; RLS and SELECT-only grants protect data. |
| `NEXT_PUBLIC_SUPABASE_URL` | Everywhere | Host env | Public. |
| `INTERNAL_FUNCTION_SECRET` | `x-internal-secret` check on `poll-games`, `score-games`, `ingest-news`, `scan-upload`, `scan-complete`, `scan-sweep`, `moderate-text`; `finishUpload` action | Supabase function secrets; Vault `internal_function_secret`; host env | Same value in all three places. Also in the SNS subscription URL for `scan-complete`. |
| `AUTH_COOKIE_SECRET` | Signs the signup-progress cookie; salts IP hashes | Host env | Falls back to a hash of the service-role key if unset; set it in production. |
| `OPENAI_API_KEY` | Text moderation (`moderate-text`, filter pipeline) | Supabase function secrets; host env | Without it moderation fails closed and chat messages are held. Text only, no user ids. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `scan-upload`, `scan-complete`, `scan-sweep` | Supabase function secrets | IAM user scoped to the scan bucket and Rekognition only (below). |
| `SCAN_S3_BUCKET`, `SCAN_SNS_TOPIC_ARN`, `SCAN_SNS_ROLE_ARN`, `AWS_REGION` | Scanners | Supabase function secrets | Not secret, but kept with the keys. |
| `TURNSTILE_SECRET_KEY` | Signup, login, recovery | Host env | Site key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. |
| `CSAM_SERVICE_KEY` (+ `CSAM_SERVICE_URL`) | `_shared/scan/csam.ts` | Supabase function secrets | Issued by Thorn Safer or Google CSAI Match under a signed agreement. |
| `ADMIN_ALERT_WEBHOOK_URL` | Admin alerts relay | Supabase function secrets | Treat as a secret: anyone with it can post fake alerts. |
| Vault: `poll_games_url`, `score_games_url`, `ingest_news_url`, `scan_sweep_url`, `scan_upload_url`, `internal_function_secret` | pg_cron jobs and the storage webhook | Supabase Vault | URLs are not secret; the shared secret is. |
| Supabase access token, database password | `supabase db push`, `functions deploy` | Owner's password manager; CI secrets only if CI deploys | Never in the repo. |

## AWS scope

One IAM user for the scanners, with a policy that allows only:

- `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on
  `arn:aws:s3:::<scan bucket>/*`;
- `rekognition:StartContentModeration`, `rekognition:GetContentModeration`;
- `iam:PassRole` on the one SNS publishing role Rekognition assumes.

No console access, no other buckets or services. The scan bucket has a 1-day
lifecycle rule, blocks all public access and uses default encryption.

## Rotation

- **Every 6 months**: rotate `INTERNAL_FUNCTION_SECRET`, `AUTH_COOKIE_SECRET`,
  AWS keys, `OPENAI_API_KEY`, `TURNSTILE_SECRET_KEY`, `CSAM_SERVICE_KEY` and
  the alert webhook. Rotate the Supabase service-role / secret key yearly.
- **Immediately** on any suspected leak (a key pasted somewhere public, a lost
  laptop, a departing admin, a gitleaks hit, or unexplained usage).
- How: see "Rotate a secret" in `docs/ops/runbook.md`. Log each rotation
  (date, secret, reason) in the admin's notes.

## Access

- **Admins**: Jason and any adult he names. Admin and mod roles live only in
  `public.user_roles`, granted by SQL or the mod console, never in
  `user_metadata`. Remove the role the day someone steps down.
- **MFA for admins and mods is an open decision** (plan, "Deferred / Open
  Questions → Security calls"): the proposal is TOTP MFA for privileged roles,
  enforced in RLS on admin tables and the quarantine bucket, with
  recovery-code resets disabled for those roles. Decide before public launch.
  Until then, admins use a unique, long password from a password manager and
  keep their recovery code offline.
- **Infrastructure accounts** (Supabase, host, AWS, GitHub, OpenAI,
  Cloudflare, CSAM service): MFA required on every one, owned by the adult
  admin, no shared logins.
- **Data access**: only admins can read `profiles_private`, `alert_log`,
  `held` content and the quarantine bucket, enforced by RLS. Every mod and
  admin action is logged in `mod_actions`.

## Application safeguards (summary)

- Client roles can only `SELECT`; every write is a `security definer` RPC or a
  service-role Edge Function that runs the filter and limit checks.
- Internal Edge Functions reject callers without the shared secret and derive
  their inputs from database records, not request bodies.
- Uploads are write-once, private, pre-moderated and scanned.
- Content filter fails closed when the moderation API is down.

## Incident response

1. Contain: rotate the affected secret, revoke sessions if needed
   (`auth.admin.signOut` per user, or rotate the JWT secret for all).
2. Assess what data was exposed, using Supabase logs.
3. Notify affected members and, if required by state breach laws, regulators.
   Get legal advice the same day.
4. Write up what happened and what changes, in this file's review log.

## Annual review checklist

- [ ] Secrets inventory matches `.env.example` and the deployed function secrets.
- [ ] Every secret rotated within the last 6 months.
- [ ] Admin and mod list in `user_roles` is current.
- [ ] MFA is on for every infrastructure account.
- [ ] Data retention policy still matches `private.delete_user_data`.
- [ ] Processors (Supabase, OpenAI, AWS, Cloudflare, CSAM service) still match the privacy notice.
- [ ] gitleaks job still runs and is green.

## Review log

| Date | Reviewer | Notes |
| --- | --- | --- |
| 2026-10-25 | (draft) | First version written with U14. |
