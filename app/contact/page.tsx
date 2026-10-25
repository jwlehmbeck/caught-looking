import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Contact" };

// Placeholder: U14 adds the real contact and appeal details.
export default function ContactPage() {
  return (
    <AuthShell title="Contact us">
      <p>
        Appeals, safety concerns, copyright notices and anything else go to the Caught Looking admins.
        A contact address and the appeal form are being set up and will appear here before launch. In the
        meantime, if you reached this page from a ban or suspension notice, hold on to the reason shown and
        check back soon.
      </p>
    </AuthShell>
  );
}
