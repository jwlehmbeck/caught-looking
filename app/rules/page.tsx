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
    </AuthShell>
  );
}
