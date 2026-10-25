import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Terms" };

// Placeholder: U14 writes the real terms with the legal review.
export default function TermsPage() {
  return (
    <AuthShell title="Terms">
      <p>
        By using Caught Looking you agree to follow the house rules, to be at least 13 years old, and to
        understand that the service is provided as-is during its private test. We store a username, a
        favorite team, a birth year and the content you post; nothing else about you. The complete terms
        and privacy notice are being prepared and will replace this page before public launch.
      </p>
    </AuthShell>
  );
}
