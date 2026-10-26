# Fan edit upload rules

This is the plain-words version shown to fans at `/rules#uploads`. The
technical flow is at the bottom for staff.

## What you can upload

- **Your own footage** from the stands or the backyard, or a **short
  commentary edit** (you talking over or cutting together baseball moments).
- **60 seconds or less.** The app checks the length before uploading and the
  scanner checks it again.
- **MP4 or MOV**, up to 150 MB.
- **3 uploads a day.** Rejected uploads count toward the three.

## What you can't upload

- **No faces of you or your friends.** Crowd shots from far away are fine;
  anything where someone can be recognized is not.
- **No school names, team jerseys with names, street signs or anything that
  says where you live or go to school.**
- **No usernames, phone numbers or other ways to contact you** on screen or
  in the title.
- **No copyrighted music.** Stadium noise, your voice and royalty-free tracks
  are fine; a song from the radio is not.
- **No clips of broadcasts or other people's videos.** Share those as links
  instead (MLB.com or YouTube).
- Nothing that isn't about baseball, and nothing that would break the house
  rules anywhere else in the app.

## How review works

1. You pick a clip and the app checks its length, size and type on your
   phone. A clip over 60 seconds is turned away before it uploads.
2. The upload goes straight to private storage. Nobody can see it yet, not
   even by guessing the link.
3. An automated scan looks at the file. Some things are turned down
   automatically (explicit content, clips that are really longer than 60
   seconds, files that aren't actually video).
4. An adult on the Caught Looking team watches every clip that passes the
   scan and approves it or turns it down. **Usually within a day.**
5. Approved clips show up in the feed as a fan edit, tap to play. Turned-down
   clips show up under **My uploads** with a reason.

Until then, My uploads shows **Pending review**.

## If an upload is turned down

You see one of these reasons:

| Reason | What it means |
| --- | --- |
| Copyright | It used footage or music that isn't yours to share. |
| Face or personal info | It showed a face, a name, a school or a place that could identify someone. |
| Contact info | It included a username, phone number or other way to contact someone. |
| Off topic | It wasn't about baseball. |
| Quality or length | It was too long, too blurry or didn't play right. |
| Unsafe | It didn't meet the safety rules. |

Fix it and try again (it counts toward your three for the day). Repeatedly
uploading things that break the rules leads to the same sanctions as anywhere
else in the app: a suspension, then a ban.

## Staff notes

- **Pre-moderation is the rule.** Nothing a member uploads is visible to any
  other member until an admin approves it. Mods cannot approve or reject
  uploads; only admins can (the Uploads tab in the mod console).
- **Scanner outcomes** (`_shared/scan/routing.ts`): CSAM hash match →
  quarantine (status `held`, `csam_quarantine` alert, follow
  `csam-procedure.md`, never shown in any queue, file preserved); explicit
  labels at 80%+ confidence → auto-reject as `unsafe` with an admin alert;
  duration over 60 s, bad magic bytes or over the size cap → auto-reject as
  `quality`; otherwise → the admin queue. A scan that never finishes within
  15 minutes puts the upload in the queue marked **unscanned**; watch those
  twice.
- **When the scanners are not configured** (no AWS keys), every upload lands
  in the queue as unscanned. That is the local-development mode and an
  acceptable launch mode only if an adult watches every clip.
- **Files.** Originals live in the private `uploads` bucket, write-once
  (members can insert into their own folder, never overwrite; they can delete
  only while the post is still pending). Approved clips are copied to the
  private `media` bucket keyed by SHA-256 and served through 60-second signed
  URLs; the original is queued for purging. Rejected originals are queued for
  purging too. Quarantined originals are kept for the report.
- **Playback** never autoplays; the card shows a poster and a tap-to-play
  button, and the `<video>` uses `preload="none"`.
- **Alerts** land in `alert_log` (admin-only) and the admin email relay:
  `upload_auto_rejected`, `scan_timeout`, `csam_quarantine`.
- **Setup prerequisites** (not needed locally): AWS account with an S3 bucket
  (1-day lifecycle rule), an SNS topic plus an IAM role Rekognition can
  publish with, scoped IAM keys in the Edge Function secrets, the Vault
  secrets `scan_upload_url`, `scan_sweep_url` and `internal_function_secret`,
  an SNS HTTPS subscription to
  `.../functions/v1/scan-complete?secret=<INTERNAL_FUNCTION_SECRET>`, and a
  CSAM matching agreement (Thorn Safer or Google CSAI Match) wired into
  `_shared/scan/csam.ts`. If the `supabase_functions` schema is not available
  at migration time, create the `storage.objects` INSERT webhook to
  `scan-upload` from the dashboard with the `x-internal-secret` header.
