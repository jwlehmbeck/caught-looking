import type { PickSplit } from "@/lib/picks/actions";
import type { ViewTeam } from "@/lib/game/view-state";

interface FanSplitProps {
  away: ViewTeam;
  home: ViewTeam;
  split: PickSplit;
  /** "at lock" when the split is the snapshot taken at first pitch. */
  caption?: string;
}

/** The fan split bar on its own (the pick card has an inline copy for the open state). */
export function FanSplit({ away, home, split, caption }: FanSplitProps) {
  const total = Math.max(split.total, 1);
  const awayPct = Math.round((split.away / total) * 100);
  const homePct = split.total === 0 ? 0 : 100 - awayPct;
  return (
    <section
      aria-label="Fan split"
      style={{
        background: "var(--cl-bg-raised)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-radius)",
        padding: 16,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ fontFamily: "var(--cl-font-body)", fontSize: 15, fontWeight: 700, letterSpacing: 0 }}>Fan split</h2>
        {caption ? <span style={{ fontSize: 12, color: "var(--cl-text-muted)" }}>{caption}</span> : null}
      </div>
      <div
        role="img"
        aria-label={`${awayPct}% picked ${away.abbreviation}, ${homePct}% picked ${home.abbreviation}`}
        style={{ height: 10, borderRadius: 5, background: "var(--cl-border-strong)", overflow: "hidden", display: "flex" }}
      >
        <div style={{ width: `${awayPct}%`, background: "var(--cl-accent)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--cl-text-muted)" }}>
        <span>
          {awayPct}% picked {away.abbreviation}
        </span>
        <span>
          {split.total.toLocaleString("en-US")} {split.total === 1 ? "fan" : "fans"} picked
        </span>
        <span>
          {homePct}% picked {home.abbreviation}
        </span>
      </div>
    </section>
  );
}
