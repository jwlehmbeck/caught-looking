import type { ResultView, ViewBadge } from "@/lib/game/view-state";

interface ResultCardProps {
  result: ResultView;
  /** "Hit rate now 76% (13 of 17)." or the unlock counter; null when the viewer had no pick. */
  hitRateLine: string | null;
  /** Badges earned on this game. */
  badges: ViewBadge[];
}

function CheckIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M7 12.5l3 3 7-7" />
    </svg>
  );
}

function MissIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}

function BadgeIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z" />
    </svg>
  );
}

/**
 * The after-final result: "You called it" (amber), "Caught looking", or
 * "You didn't pick this one", with the viewer's updated season hit rate and
 * any badges earned on this game.
 */
export function ResultCard({ result, hitRateLine, badges }: ResultCardProps) {
  const hit = result.tone === "hit";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section
        aria-label="Your result"
        data-tone={result.tone}
        style={{
          background: hit ? "var(--cl-accent)" : "var(--cl-bg-raised)",
          color: hit ? "var(--cl-on-accent)" : "var(--cl-text)",
          border: hit ? "1px solid var(--cl-accent)" : "1px solid var(--cl-border)",
          borderRadius: "var(--cl-radius)",
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span style={{ flexShrink: 0, color: hit ? "var(--cl-on-accent)" : "var(--cl-text-muted)" }}>
          {hit ? <CheckIcon /> : <MissIcon />}
        </span>
        <div style={{ display: "grid", gap: 2 }}>
          <h2 style={{ fontSize: 22, textTransform: "uppercase" }}>{result.title}</h2>
          <p style={{ fontSize: 13, fontWeight: 500 }}>
            {result.detail}
            {hitRateLine ? ` ${hitRateLine}` : ""}
          </p>
        </div>
      </section>

      {badges.map((badge) => (
        <section
          key={badge.slug}
          aria-label={`New badge: ${badge.name}`}
          style={{
            background: "var(--cl-bg-raised)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius)",
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              border: "2px solid var(--cl-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cl-accent)",
              flexShrink: 0,
            }}
          >
            <BadgeIcon />
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: "var(--cl-text-muted)", letterSpacing: 0.5 }}>
              {badge.timesEarned > 1 ? `BADGE · ×${badge.timesEarned}` : "NEW BADGE"}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{badge.name}</div>
            <div style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>{badge.description}</div>
          </div>
        </section>
      ))}
    </div>
  );
}
