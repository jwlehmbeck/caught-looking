import type { ViewGame } from "@/lib/game/view-state";
import { teamById } from "@/lib/game/view-state";

export interface TopPredictorRow {
  user_id: string;
  username: string;
  team_id: number;
  picks_scored: number;
  picks_correct: number;
  /** 0–1 fraction from the RPC. */
  hit_rate: number | string;
}

interface TopPredictorsProps {
  game: ViewGame;
  rows: TopPredictorRow[];
}

function pct(rate: number | string): string {
  const n = typeof rate === "string" ? Number.parseFloat(rate) : rate;
  if (!Number.isFinite(n)) return "–";
  return `${Math.round(n * 100)}%`;
}

/**
 * "What the top predictors picked": the three best hit rates among this
 * game's pickers (unlocked at 10 scored picks), with their pick. The RPC
 * returns nothing until the viewer has picked or the game has locked, so an
 * empty list means "nothing to show yet" rather than an error.
 */
export function TopPredictors({ game, rows }: TopPredictorsProps) {
  return (
    <section
      aria-labelledby="top-predictors-heading"
      style={{
        background: "var(--cl-bg-card)",
        borderRadius: "var(--cl-radius)",
        padding: 16,
        display: "grid",
        gap: 10,
      }}
    >
      <h2 id="top-predictors-heading" style={{ fontFamily: "var(--cl-font-body)", fontSize: 15, fontWeight: 700, letterSpacing: 0 }}>
        What the top predictors picked
      </h2>
      {rows.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
          No ranked predictors on this game yet. Hit rates unlock after 10 scored picks.
        </p>
      ) : (
        <ul style={{ listStyle: "none", display: "grid", gap: 10 }}>
          {rows.map((row) => {
            const team = teamById(game, row.team_id);
            return (
              <li key={row.user_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span>
                  @{row.username} · {pct(row.hit_rate)}
                </span>
                <span style={{ fontWeight: 700 }} aria-label={team ? `picked ${team.name}` : undefined}>
                  {team?.abbreviation ?? "–"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
