# DMCA and copyright policy

How Caught Looking handles copyright complaints, so it keeps the safe harbor
in 17 U.S.C. § 512. The member-facing version is in `/terms#copyright` and
`/contact`.

Last updated: 2026-10-25. Designated agent: `[DMCA AGENT NAME/ADDRESS]`,
`[CONTACT EMAIL]` (Jason is the named contact until set).

## 1. Register a designated agent (before launch)

- Register through the US Copyright Office's online DMCA Designated Agent
  Directory (dmca.copyright.gov). Fee: **$6**.
- The registration **expires after 3 years**. Put the renewal date on the
  admin calendar and renew (another $6) before it lapses; a lapsed
  registration loses the safe harbor.
- The agent name, address, phone and email on the registration must match the
  `/terms` and `/contact` pages. A P.O. box is allowed for the address.
- Update the registration within a few days if any detail changes.

## 2. Takedown steps

1. **Receive** the notice at the agent address. Log it (date, sender, work,
   location in the app) in `mod_actions` as `dmca.notice`.
2. **Check it is complete**: signature, the work, the location of the
   material, contact details, a good-faith statement, and an accuracy
   statement under penalty of perjury. If it's missing pieces, reply and ask
   for them; don't ignore it.
3. **Remove expeditiously** — within 2 days, sooner for clear cases. Use the
   mod console to set the post to `removed` (fan edits: the file is queued for
   purging).
4. **Notify the member** in the app that the content was removed for a
   copyright complaint and that they may send a counter-notice. Do not give
   the member the complainant's personal details beyond what's needed.
5. **Record a strike** against the member (see section 4).

## 3. Counter-notice

1. A member who thinks the removal was a mistake sends a counter-notice to the
   agent: their signature, the removed material and where it was, a
   statement under penalty of perjury that it was removed by mistake or
   misidentification, and consent to federal court jurisdiction.
   - Because members are teens and we hold no real names, a counter-notice
     from a minor should come with a parent or guardian. Ask the lawyer to
     confirm wording during legal review.
2. **Forward** the counter-notice to the complainant and tell them the
   material will be restored in 10–14 business days unless they file a court
   action.
3. **Restore** the material after 10 and no later than 14 business days,
   unless the complainant reports they've filed suit. Remove the strike if
   restored.
4. Log each step in `mod_actions` (`dmca.counter`, `dmca.restored`).

## 4. Repeat-infringer policy

- Each upheld copyright complaint (removed and not reversed by a successful
  counter-notice) is **one strike**.
- **3 upheld strikes → permanent ban** (`issue_sanction(user, 'ban',
  'repeat copyright infringement')`).
- Strikes do not expire during the private test. Revisit at the annual review.
- Upload rejections for copyright by an admin before anything is published
  are **not** strikes; they are reasons on My uploads.
- The policy is stated publicly in `/terms` and enforced the same for
  everyone.

## 5. Bad-faith notices

If a notice is clearly abusive (for example, a member trying to get a rival's
post removed), don't act on it and keep a record. Ask the lawyer before
refusing a notice that looks legitimate on its face.
