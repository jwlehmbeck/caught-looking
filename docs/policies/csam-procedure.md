# CSAM procedure

What we do if anyone finds, or a scanner flags, sexual content involving a minor. This is a legal duty, not a judgment call. Only admins handle it. Mods never see this material.

## The rules

1. **Do not share it, download it, or look at it longer than needed to confirm what it is.** Never send it in Slack, email or text. Never show it to a mod or anyone outside this procedure.
2. **Do not delete it.** US law (18 U.S.C. § 2258A) requires us to report it and preserve it for one year.
3. **Do not warn the uploader.**

## Who does what

| Step | Who | What |
| --- | --- | --- |
| 1. Quarantine | Admin (or the scanner, automatically) | Move the file to the `quarantine` storage bucket. That bucket is readable by admins only and never by the app. The post goes to status `held`. |
| 2. Ban | Admin | Ban the account with `issue_sanction(user, 'ban', 'child safety')`. Keep the hashed identifier so a deleted account can't lift the ban. |
| 3. Report | Named admin (Jason) | File a report with the NCMEC CyberTipline at https://report.cybertip.org within 24 hours. Include the file hash, upload time, the account id, IP if logged, and anything the user wrote. Save the CyberTipline report number in `mod_actions` as `csam.reported`. |
| 4. Preserve | Admin | Keep the file, the account record, the report and every related log for one year from the report date. Nothing in the deletion or retention jobs may touch quarantined items. |
| 5. Close out | Admin | After one year, and only if no law-enforcement request is open, delete the quarantined file and log `csam.purged`. |

## If a mod runs into it

Stop. Hide the post (`Hide`) so nobody else sees it, do not open it again, and message an admin right away with the post id only. Do not describe or forward the content. The admin takes it from there and logs that you reported it.

## If law enforcement asks

Preserve everything they name. Do not hand over user data without a valid request. Route every request to the named admin.

## Detection

- Every fan edit is scanned before anyone sees it (plan U11): a CSAM hash match sends the file straight to quarantine and this procedure, with no human review step and no notification to the uploader.
- Reports in the "urgent" or "inappropriate" categories that turn out to be this material follow the same path.

## Contact

Named admin and child-safety contact: Jason Lehmbeck. The same person signs the NCMEC registration and keeps a copy of every CyberTipline receipt outside the app.
