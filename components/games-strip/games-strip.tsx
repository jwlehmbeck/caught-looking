import Link from "next/link";

import { LocalTime } from "@/components/local-time";
import type { StripItem } from "@/lib/home/home-state";

/**
 * Today's games as a horizontal row of small cards: live score with
 * "● LIVE", the start time, or FINAL. Each card opens the game page. The
 * row scrolls inside itself so the page never scrolls sideways.
 */
export function GamesStrip({ items }: { items: StripItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label="Today's games"
      style={{
        listStyle: "none",
        display: "flex",
        gap: 8,
        overflowX: "auto",
        maxWidth: "100%",
        padding: "2px 0 6px",
        scrollbarWidth: "thin",
      }}
    >
      {items.map((item) => (
        <li key={item.gameId} style={{ flex: "0 0 auto" }}>
          <Link
            href={`/game/${item.gameId}`}
            aria-label={item.label}
            style={{
              minWidth: 108,
              minHeight: "var(--cl-tap)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "8px 12px",
              borderRadius: "var(--cl-radius-sm)",
              background: "var(--cl-bg-raised)",
              border: `${item.highlight ? 2 : 1}px solid ${item.highlight ? "var(--cl-accent)" : "var(--cl-border)"}`,
              color: "var(--cl-text)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                color: item.status.kind === "live" ? "var(--cl-accent)" : "var(--cl-text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {item.status.kind === "time" ? <LocalTime iso={item.status.iso} /> : item.status.text}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>{item.matchup}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
