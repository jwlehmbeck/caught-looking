import { HIT_RATE_UNLOCK_PICKS, hitRateLabel, hitRateUnlocked } from "@shared/domain/scoring.ts";

interface HitRateChipProps {
  stats: { picks_scored: number; picks_correct: number };
  /** "Season" / "Lifetime" — read by screen readers and shown small. */
  scope?: string;
  size?: "sm" | "lg";
}

/**
 * The hit-rate chip. Shows "67%" once 10 picks are scored and
 * "4 of 10 picks to unlock" before, so a brand-new fan never sees a scary 0%.
 */
export function HitRateChip({ stats, scope, size = "sm" }: HitRateChipProps) {
  const unlocked = hitRateUnlocked(stats);
  const label = hitRateLabel(stats);
  const big = size === "lg";

  return (
    <span
      role="group"
      aria-label={`${scope ? `${scope} hit rate: ` : "Hit rate: "}${
        unlocked ? `${label}, ${stats.picks_correct} of ${stats.picks_scored} picks right` : label
      }`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: "var(--cl-tap)",
        padding: big ? "8px 16px" : "0 12px",
        borderRadius: "var(--cl-radius-pill)",
        background: unlocked ? "var(--cl-accent)" : "var(--cl-bg-raised)",
        color: unlocked ? "var(--cl-on-accent)" : "var(--cl-text-muted)",
        border: unlocked ? "0" : "1px dashed var(--cl-border-strong)",
        fontWeight: 700,
        fontSize: big ? 18 : 14,
        whiteSpace: "nowrap",
      }}
    >
      {unlocked ? (
        <>
          <span style={{ fontFamily: "var(--cl-font-display)", fontSize: big ? 28 : 18, letterSpacing: 0.5 }}>{label}</span>
          <span style={{ fontWeight: 500, fontSize: big ? 14 : 12, opacity: 0.85 }}>
            {stats.picks_correct}/{stats.picks_scored}
            {scope ? ` · ${scope}` : ""}
          </span>
        </>
      ) : (
        <>
          <span style={{ fontWeight: 500 }}>{label}</span>
          <meter
            aria-hidden="true"
            min={0}
            max={HIT_RATE_UNLOCK_PICKS}
            value={Math.min(stats.picks_scored, HIT_RATE_UNLOCK_PICKS)}
            style={{ width: big ? 72 : 48, height: 8 }}
          />
        </>
      )}
    </span>
  );
}
