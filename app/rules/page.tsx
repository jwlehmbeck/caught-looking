import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "House rules" };

// Placeholder: U14 writes the real text with the legal review.
export default function RulesPage() {
  return (
    <AuthShell title="House rules">
      <p>
        Caught Looking is a place for baseball fans aged 13 and up to pick winners, talk ball and share
        edits. Be decent to each other, keep real names, photos of people, contact details and locations
        out of it, and remember that picks are for bragging rights only. Anything that breaks these rules
        can be hidden or removed, and repeat problems lead to mutes, suspensions or a ban. The full rules
        are being written and will replace this page before launch.
      </p>
      <h2 id="uploads" style={{ fontSize: 20, marginTop: 20 }}>
        Fan edit uploads
      </h2>
      <p>
        Upload your own footage or a short commentary edit, 60 seconds or less, up to 3 a day. No faces of
        you or your friends, no school names or locations, no copyrighted music. Every upload is scanned
        and then checked by an adult on the team before anyone else sees it; that usually takes less than
        a day. If an edit is turned down you see why under My uploads and can try again. The full version
        lives in docs/policies/upload-rules.md.
      </p>
    </AuthShell>
  );
}
