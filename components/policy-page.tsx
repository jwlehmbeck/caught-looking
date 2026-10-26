import Link from "next/link";

import styles from "./policy-page.module.css";

/** The date every policy page currently shows. Bump when the text changes. */
export const POLICY_LAST_UPDATED = "2026-10-25";

/** Stand-ins for values the owner still has to supply (see docs/launch-checklist.md). */
export const CONTACT_EMAIL = "[CONTACT EMAIL]";
export const DMCA_AGENT = "[DMCA AGENT NAME/ADDRESS]";

export const POLICY_LINKS = [
  { href: "/rules", label: "Rules" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/child-safety", label: "Child safety" },
  { href: "/contact", label: "Contact" },
] as const;

/** Small, muted links to every policy page. Used on policy pages, home and settings. */
export function PolicyLinks({ label = "Policies" }: { label?: string }) {
  return (
    <nav aria-label={label}>
      <ul className={styles.links}>
        {POLICY_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface PolicyPageProps {
  title: string;
  lede?: string;
  /** Shows the "Draft — pending legal review" notice. */
  draft?: boolean;
  children: React.ReactNode;
}

/**
 * Shared layout for the public policy pages (rules, terms, privacy, child
 * safety, contact). Server component, phone-first, readable signed out.
 * Each child should be a <section> with an <h2>.
 */
export function PolicyPage({ title, lede, draft = false, children }: PolicyPageProps) {
  return (
    <main className={`cl-shell ${styles.page}`}>
      <Link href="/" aria-label="Caught Looking home" className={styles.wordmark}>
        CAUGHT&nbsp;<span style={{ color: "var(--cl-accent)" }}>LOOKING</span>
      </Link>

      {draft ? (
        <p role="note" className={styles.draft}>
          <strong>Draft — pending legal review.</strong> This page may change before Caught Looking opens to the
          public.
        </p>
      ) : null}

      <header className={styles.header}>
        <h1>{title}</h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        <p className={styles.updated}>
          Last updated <time dateTime={POLICY_LAST_UPDATED}>October 25, 2026</time>
        </p>
      </header>

      <div className={styles.body}>{children}</div>

      <footer className={styles.footer}>
        <Link href="/" className={styles.home}>
          ← Back to Caught Looking
        </Link>
        <PolicyLinks />
        <p className={styles.disclaimer}>Caught Looking is not affiliated with MLB or any club.</p>
      </footer>
    </main>
  );
}

/** A muted aside inside a policy section. */
export function PolicyNote({ children }: { children: React.ReactNode }) {
  return <p className={styles.muted}>{children}</p>;
}
