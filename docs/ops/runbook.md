# Ops runbook

Short, practical steps for running Caught Looking in production. Pair with
`docs/launch-checklist.md` and `docs/policies/security-program.md`.

## Deploy

1. **Supabase project** (Pro plan). Note the project ref, URL, publishable
   key and service-role key. Turn off public email signups (Auth settings);
   signup runs through the server action.
2. **Database**:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. **Edge Functions** — deploy each one:
   ```bash
   for f in poll-games score-games ingest-news moderate-text scan-upload scan-complete scan-sweep; do
     npx supabase functions deploy "$f" --no-verify-jwt
   done
   ```
   (`--no-verify-jwt` because these are called by cron, webhooks and SNS and
   check `x-internal-secret` themselves.)
4. **Function secrets**:
   ```bash
   npx supabase secrets set INTERNAL_FUNCTION_SECRET=... OPENAI_API_KEY=... \
     AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
     SCAN_S3_BUCKET=... SCAN_SNS_TOPIC_ARN=... SCAN_SNS_ROLE_ARN=... \
     CSAM_SERVICE_URL=... CSAM_SERVICE_KEY=... ADMIN_ALERT_WEBHOOK_URL=...
   ```
5. **Vault secrets** (SQL editor), then re-run the cron blocks from the U4,
   U5, U10 and U11 migrations (or `select cron.schedule(...)` by hand):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/poll-games',   'poll_games_url');
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/score-games',  'score_games_url');
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/ingest-news',  'ingest_news_url');
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/scan-sweep',   'scan_sweep_url');
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/scan-upload',  'scan_upload_url');
   select vault.create_secret('<same value as INTERNAL_FUNCTION_SECRET>',            'internal_function_secret');
   select jobname, schedule, active from cron.job;  -- expect poll-games, score-games, ingest-news, scan-sweep
   ```
   If the storage webhook wasn't created by the U11 migration, add it in the
   dashboard: Database → Webhooks → `storage.objects` INSERT → POST to
   `scan-upload` with header `x-internal-secret`.
6. **Host env vars** (Vercel or other host, production environment only):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_FUNCTION_SECRET`,
   `AUTH_COOKIE_SECRET`, `OPENAI_API_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
   `TURNSTILE_SECRET_KEY`. Then deploy the Next app.
7. Smoke test: open `/signup`, `/rules`, `/child-safety`; sign up with an
   invite code; check `cron.job_run_details` shows successful runs.

## Create the first admin

Before any admin exists there is no mod console, so make one bootstrap invite
code in the SQL editor, sign up with it, then grant the role:

```sql
-- 1. One-use bootstrap invite code (pick your own random string).
insert into public.invite_codes (code_hash, max_uses, expires_at, note)
values (private.hash_invite_code('PICK-A-LONG-RANDOM-CODE'), 1, now() + interval '1 day', 'bootstrap admin');

-- 2. After signing up with it at /signup:
insert into public.user_roles (user_id, role, granted_by)
select id, 'admin', null
  from public.profiles
 where normalized_username = 'jason_username_here'
on conflict (user_id) do update set role = 'admin';
```

Sign out and back in so the new role is picked up. Add a second admin the same
way (or from the mod console once it supports it), and remove roles with
`delete from public.user_roles where user_id = ...`.

## Generate invite codes

Admins only: Home → **Mod** → **Invites** tab (`/mod?tab=invites`). Choose how
many codes and uses; codes are shown **once**, so copy them straight away and
send them privately to each tester. Only hashes are stored.

## Alerts and what to do

Alerts arrive through `ADMIN_ALERT_WEBHOOK_URL` and are logged in
`public.alert_log` (admin-only).

| Alert | Meaning | Do this |
| --- | --- | --- |
| `poller_failure` | `poll-games` failed 3 times in a row (re-alerts every 30) | Check function logs. Usually MLB API down or schema change. Picks still lock at scheduled time in the database; scores will catch up once polling works. If MLB changed shape, fix the adapter in `_shared` and redeploy. |
| `scorer_failure` | `score-games` hit an error | Check logs; scoring is idempotent, so redeploy the fix and it catches up. Never edit `picks` by hand. |
| `urgent_report` | An urgent or under-13 report landed | Admin first look within **12 hours** in the mod console. Danger → point to 988 / 741741 and, if immediate, 911. Under 13 → confirm and delete the account. |
| `upload_auto_rejected` | Scanner auto-rejected explicit content | Review the alert details (not the file, unless needed). Consider a sanction. If it may involve a minor, treat it as `csam_quarantine`. |
| `scan_timeout` | A scan didn't finish in 15 minutes | Upload is in the queue marked **unscanned**; watch it twice before approving. Check AWS/SNS if it keeps happening. |
| `csam_quarantine` | Hash match on an upload | **Follow `docs/policies/csam-procedure.md` exactly.** Don't open, share or delete. Ban, file the CyberTipline report within 24 h, preserve for 1 year. |

Weekly: glance at Supabase usage (storage, egress, Realtime connections) and
`alert_log`.

## Rotate a secret

1. Generate the new value (e.g. `openssl rand -base64 48` for shared secrets;
   new key in the provider console for AWS/OpenAI/Turnstile/CSAM).
2. Update **every place it lives** (see the inventory in
   `security-program.md`):
   - Function secrets: `npx supabase secrets set NAME=new`
   - Vault: `select vault.update_secret((select id from vault.secrets where name = 'internal_function_secret'), 'new');`
   - Host env: update and redeploy the app.
   - For `INTERNAL_FUNCTION_SECRET`, also update the SNS subscription URL for `scan-complete` and the storage webhook header.
3. Verify: next cron run succeeds (`cron.job_run_details`), a test chat
   message passes moderation, a test upload scans.
4. Revoke the old value at the provider (AWS: deactivate then delete the old
   access key).
5. Log the date, secret and reason.

For the Supabase service-role key: rotate in the dashboard (API keys), update
the host env, redeploy. Functions pick up the new key automatically.
