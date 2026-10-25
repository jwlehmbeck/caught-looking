import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign up" };

// Placeholder. U3 replaces this with the age screen, invite code, house
// rules, username, favorite team and recovery code flow.
export default function SignupPage() {
  return (
    <main className="cl-shell" style={{ paddingTop: 52 }}>
      <h1 style={{ fontSize: 28 }}>
        CAUGHT <span style={{ color: "var(--cl-accent)" }}>LOOKING</span>
      </h1>
      <p style={{ color: "var(--cl-text-muted)", marginTop: 12 }}>
        Sign-up opens soon.
      </p>
    </main>
  );
}
