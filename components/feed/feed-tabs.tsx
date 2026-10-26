import Link from "next/link";

import type { FeedTab } from "@shared/domain/hot-score.ts";

interface FeedTabsProps {
  active: FeedTab;
  /** The page the pills link to; `?tab=` is appended. */
  basePath?: string;
}

const TABS: { id: FeedTab; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "new", label: "New" },
  { id: "my_team", label: "My Team" },
];

/** Hot / New / My Team pills. Plain links, so the tab survives a reload. */
export function FeedTabs({ active, basePath = "/" }: FeedTabsProps) {
  return (
    <nav aria-label="Feed" style={{ display: "flex", gap: 8 }}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={`${basePath}?tab=${t.id}`}
            aria-current={on ? "page" : undefined}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "var(--cl-tap)",
              borderRadius: "var(--cl-radius-pill)",
              border: on ? "0" : "1px solid var(--cl-border-strong)",
              background: on ? "var(--cl-accent)" : "transparent",
              color: on ? "var(--cl-on-accent)" : "var(--cl-text)",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
