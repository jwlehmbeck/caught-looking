import Link from "next/link";

interface AuthShellProps {
  /** The screen's heading, e.g. "Pick a username". */
  title: string;
  /** One line under the heading. */
  lede?: string;
  /** "Step 3 of 6" style helper, read by screen readers too. */
  progress?: string;
  children: React.ReactNode;
  /** Links under the card, e.g. "Already have an account? Log in". */
  footer?: React.ReactNode;
}

/**
 * The layout every auth screen shares: wordmark up top, one card, links
 * below. Phone-first; the card is the full width up to 480 px.
 */
export function AuthShell({ title, lede, progress, children, footer }: AuthShellProps) {
  return (
    <main className="cl-shell" style={{ paddingTop: 40, paddingBottom: 48 }}>
      <Link
        href="/signup"
        aria-label="Caught Looking home"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: "var(--cl-tap)",
          color: "var(--cl-text)",
          fontFamily: "var(--cl-font-display)",
          fontSize: 22,
          letterSpacing: 0.5,
        }}
      >
        CAUGHT&nbsp;<span style={{ color: "var(--cl-accent)" }}>LOOKING</span>
      </Link>

      <section
        aria-labelledby="auth-title"
        style={{
          marginTop: 20,
          background: "var(--cl-bg-card)",
          border: "1px solid var(--cl-border)",
          borderRadius: "var(--cl-radius)",
          padding: "24px 20px",
          display: "grid",
          gap: 16,
        }}
      >
        {progress ? (
          <p style={{ fontSize: 13, color: "var(--cl-text-muted)", letterSpacing: 0.3 }}>{progress}</p>
        ) : null}
        <h1 id="auth-title" style={{ fontSize: 30 }}>
          {title}
        </h1>
        {lede ? <p style={{ color: "var(--cl-text-muted)" }}>{lede}</p> : null}
        {children}
      </section>

      {footer ? (
        <div style={{ marginTop: 20, display: "grid", gap: 8, color: "var(--cl-text-muted)", fontSize: 15 }}>
          {footer}
        </div>
      ) : null}
    </main>
  );
}
