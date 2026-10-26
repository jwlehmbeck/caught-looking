# Data retention policy

What Caught Looking keeps, for how long, and how it is deleted. The teen-facing
summary is the "How long we keep it" section of `/privacy#retention`; this
document is the source of truth behind it and must match
`private.delete_user_data` (called by `public.delete_account`) in
`supabase/migrations/20261025120200_rpcs.sql`.

Written to meet the amended COPPA Rule's expectation of a written retention
policy, even though the service is for users 13 and up. Reviewed with the
annual security review (see `security-program.md`).

Last updated: 2026-10-25. Owner: the adult admin (Jason).

## Principles

- Collect the minimum: username, favorite team, birth year, password hash,
  recovery-code hash, picks, user content, hashed IP security logs. No real
  name, email, phone, photo of the user, location or contacts.
- Keep data only as long as it is needed to run the app, keep people safe, or
  meet a legal duty.
- A safety hold beats deletion. Deletion can never be used to lift a ban or
  destroy evidence.

## Retention schedule

| Data | Where | Kept for | How it ends |
| --- | --- | --- | --- |
| Username, favorite team | `profiles` | Until account deletion | Renamed to `deleted_<8 hex>`, team cleared, status `deleted` |
| Birth year, team-change and recovery state | `profiles_private` | Until account deletion | Row deleted |
| Synthetic auth email and password hash | `auth.users` | Until account deletion | `auth.admin.deleteUser` in `lib/auth/settings-actions.ts` right after the RPC |
| Recovery code hash | `recovery_codes` | Until rotated or account deletion | Replaced on each use or regenerate; row deleted on deletion |
| Picks | `picks` | Indefinitely, for historical fan splits | `user_id` set to null on deletion (detached, not deleted) |
| Stats, badges, votes, poll votes, blocks, roles | `user_stats`, `user_badges`, `votes`, `poll_votes`, `blocks`, `user_roles` | Until account deletion | Rows deleted |
| Chat messages, comments | `chat_messages`, `comments` | Until account deletion | Body replaced with `[deleted]`, `author_id` null (or held, see below) |
| Posts (links, news shares, fan edits) | `posts` | Until account deletion or removal | Status `removed`, `author_id` null (or held) |
| Uploaded video files | `uploads` / `media` buckets | Until rejected, removed, or account deletion | Path queued in `deletion_queue` and purged from storage |
| Rejected or superseded upload originals | `uploads` bucket | Until purged | Queued in `deletion_queue` at reject/approve time |
| AWS scan copy | S3 scan bucket | Minutes; 1 day maximum | Deleted by `scan-complete`; bucket lifecycle rule deletes anything left after 1 day |
| Reports the user filed | `reports` | Until resolved, then 1 year | `reporter_id` null on deletion |
| Username of a deleted account | `username_holds` | 90 days | Becomes available after `released_at` |
| Hashed id and ban flag of a deleted account | `deleted_identities` | Indefinitely while banned; otherwise 1 year | Keeps a ban in force after deletion |
| Moderation and sanction records | `mod_actions`, `sanctions` | 1 year after the action or sanction end | Pruned by the retention job (see Gaps) |
| Admin alerts | `alert_log` | 1 year | Pruned by the retention job (see Gaps) |
| Security logs (hashed IPs: recovery throttle, signup/login throttles) | `recovery_attempts` and similar | 90 days maximum (recovery attempts are pruned after about 2 hours) | Deleted by the throttle's own cleanup |
| Hosting and edge request logs | Supabase, host | Provider default, no more than 90 days | Provider retention settings |

## Account deletion

A member deletes their account in Settings after a confirmation that it cannot
be undone. `public.delete_account()` runs `private.delete_user_data(uid)`:

1. Records `sha256(user_id)` in `deleted_identities` with the current ban
   flag, so a deleted account cannot come back to dodge a ban.
2. Holds the username for 90 days in `username_holds`.
3. If **no** safety hold applies: queues every uploaded file for purging,
   marks posts `removed` with no author, replaces comment and chat bodies with
   `[deleted]` with no author, and detaches the user from reports they filed.
4. If a safety hold applies: sets the user's posts, comments and chat messages
   to status `held` (admin-only) instead of erasing them.
5. Detaches picks (`user_id = null`).
6. Deletes `profiles_private`, `recovery_codes`, `blocks`, `votes`,
   `poll_votes`, `user_stats`, `user_badges` and `user_roles` rows.
7. Renames the profile to `deleted_<id prefix>`, clears the team and sets
   status `deleted`.

The server action then deletes the `auth.users` row and signs the session out.

## Safety hold

`private.needs_safety_hold(uid)` is true when the user has an open urgent,
under-13 or CSAM report against them, or an active sanction. Under a hold:

- Content is moved to status `held`, visible to admins only, not deleted.
- Held content is kept **up to 1 year**, then deleted by an admin once the
  related reports are closed and no sanction is active.
- Anything tied to a NCMEC CyberTipline report is preserved for **one year
  from the report date** (18 U.S.C. § 2258A), or longer if law enforcement
  asks in writing, following `csam-procedure.md`. Quarantined files are never
  touched by the deletion queue or any retention job.

## Under-13 accounts

When an admin confirms an account belongs to someone under 13 (an `under_13`
report, or a parent's request through the contact address), the admin deletes
the account the same day it is confirmed. The age-screen device flag stays so
the same device cannot retry. Parent requests are answered within 2 days.

## Parent and member requests

Requests to see, correct or delete data go to `[CONTACT EMAIL]`. Because we
hold no email or real name, we verify by username plus a detail only the
account holder or parent would know, and we never ask a teen for more personal
information than that. Deletion requests are completed within 30 days.

## Gaps to close before launch

- **Storage purge worker.** Paths are queued in `public.deletion_queue`, but no
  Edge Function or cron job yet removes them from the `uploads` / `media`
  buckets. Build one (service role, skips quarantine) or purge by hand weekly
  until it exists. Tracked in `docs/launch-checklist.md`.
- **Yearly pruning job** for `mod_actions`, `sanctions`, `alert_log`, closed
  `reports` and released `username_holds`. Until it exists, the admin runs the
  pruning SQL each quarter.
