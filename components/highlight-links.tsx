import type { ViewHighlight } from "@/lib/game/view-state";

interface HighlightLinksProps {
  highlights: ViewHighlight[];
  /** Cap on how many cards render (the poller can store dozens). */
  limit?: number;
}

const MLB_HOST = /^https:\/\/(www\.)?mlb\.com\//i;

function formatDuration(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Highlight link cards. Each is a plain anchor to MLB.com that opens in a new
 * tab; nothing plays in the app. Only https://www.mlb.com links render.
 */
export function HighlightLinks({ highlights, limit = 8 }: HighlightLinksProps) {
  const items = highlights.filter((h) => typeof h.url === "string" && MLB_HOST.test(h.url) && h.title).slice(0, limit);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="highlights-heading" style={{ display: "grid", gap: 10 }}>
      <h2 id="highlights-heading" style={{ fontSize: 22, textTransform: "uppercase" }}>
        Highlights
      </h2>
      <ul style={{ listStyle: "none", display: "grid", gap: 10 }}>
        {items.map((h) => {
          const duration = formatDuration(h.durationSeconds);
          return (
            <li key={h.url}>
              <a
                href={h.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--cl-text)",
                  background: "var(--cl-bg-raised)",
                  border: "1px solid var(--cl-border)",
                  borderRadius: "var(--cl-radius-sm)",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: "var(--cl-tap)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 64,
                    height: 40,
                    borderRadius: 8,
                    background: "var(--cl-border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--cl-accent)",
                    flexShrink: 0,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span style={{ display: "grid", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{h.title}</span>
                  <span style={{ fontSize: 12, color: "var(--cl-text-muted)" }}>
                    Opens on MLB.com{duration ? ` · ${duration}` : ""}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
