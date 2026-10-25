import type { BadgeSlug } from "@shared/domain/badges.ts";

export interface BadgeView {
  slug: string;
  name: string;
  description: string;
  repeatable: boolean;
  sort_order: number;
  earned: boolean;
  times_earned: number;
  first_earned: string | null;
  last_earned: string | null;
}

/** A plain glyph per badge. No images, no team marks. */
const GLYPHS: Record<BadgeSlug, string> = {
  rookie_card: "★",
  caught_looking: "ꓘ",
  hot_streak: "▲",
  upset_special: "!",
  perfect_game: "27",
  iron_man: "30",
  ace: "A",
};

function glyphFor(slug: string): string {
  return (GLYPHS as Record<string, string>)[slug] ?? "•";
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * All seven badges in a 3-up grid. Unearned ones are dashed silhouettes;
 * repeatable ones carry a "×N" count once earned more than once.
 */
export function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  const sorted = [...badges].sort((a, b) => a.sort_order - b.sort_order);
  const earnedCount = sorted.filter((b) => b.earned).length;

  return (
    <section aria-labelledby="badges-heading" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 id="badges-heading" style={{ fontSize: 22 }}>
          Badges
        </h2>
        <span style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
          {earnedCount} of {sorted.length}
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {sorted.map((b) => (
          <li
            key={b.slug}
            aria-label={`${b.name}: ${b.earned ? (b.repeatable && b.times_earned > 1 ? `earned ${b.times_earned} times` : "earned") : "locked"}. ${b.description}`}
            style={{
              display: "grid",
              gap: 6,
              justifyItems: "center",
              textAlign: "center",
              padding: "14px 8px 12px",
              minHeight: 120,
              borderRadius: "var(--cl-radius-sm)",
              background: b.earned ? "var(--cl-bg-card)" : "transparent",
              border: b.earned ? "1px solid var(--cl-border)" : "1px dashed var(--cl-border-strong)",
              color: b.earned ? "var(--cl-text)" : "var(--cl-text-muted)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                fontFamily: "var(--cl-font-display)",
                fontSize: 22,
                background: b.earned ? "var(--cl-accent)" : "var(--cl-bg-raised)",
                color: b.earned ? "var(--cl-on-accent)" : "var(--cl-border-strong)",
              }}
            >
              {glyphFor(b.slug)}
              {b.earned && b.repeatable && b.times_earned > 1 ? (
                <span
                  style={{
                    position: "absolute",
                    right: -6,
                    bottom: -4,
                    padding: "1px 6px",
                    borderRadius: "var(--cl-radius-pill)",
                    background: "var(--cl-text)",
                    color: "var(--cl-bg)",
                    fontFamily: "var(--cl-font-body)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ×{b.times_earned}
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{b.name}</span>
            <span style={{ fontSize: 11, color: "var(--cl-text-muted)", lineHeight: 1.25 }}>
              {b.earned
                ? b.repeatable && b.times_earned > 1
                  ? `×${b.times_earned} · last ${shortDate(b.last_earned)}`
                  : shortDate(b.first_earned)
                : b.description}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
