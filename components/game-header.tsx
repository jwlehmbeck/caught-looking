import Link from "next/link";

import { LocalTime } from "@/components/local-time";
import type { HeaderCenter, ViewTeam } from "@/lib/game/view-state";

interface GameHeaderProps {
  away: ViewTeam;
  home: ViewTeam;
  /** ISO timestamp of the scheduled first pitch. */
  gameDate: string;
  center: HeaderCenter;
  /** Short line under the back arrow ("Picks are locked", "Final", ...). */
  statusLine?: string | null;
  backHref?: string;
  /** Optional team colors (never the only way a team is identified). */
  colors?: { away?: string; home?: string };
}

function TeamBlock({ team, color, side }: { team: ViewTeam; color?: string; side: "away" | "home" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div
        aria-label={`${team.name}, ${side}`}
        style={{ fontFamily: "var(--cl-font-display)", fontSize: 40, lineHeight: 1, letterSpacing: 0.5 }}
      >
        {team.abbreviation}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--cl-text-muted)" }}>
        {color ? (
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: color,
              border: "1px solid rgba(244, 241, 234, 0.6)",
              flexShrink: 0,
            }}
          />
        ) : null}
        <span>{team.name}</span>
      </div>
    </div>
  );
}

/**
 * Back arrow, date line, then the big three-column block: away abbreviation,
 * center (start time, score or PPD), home abbreviation. Server component.
 */
export function GameHeader({ away, home, gameDate, center, statusLine, backHref = "/picks", colors }: GameHeaderProps) {
  return (
    <header style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: -8 }}>
        <Link
          href={backHref}
          aria-label="Back to today's games"
          style={{
            width: "var(--cl-tap)",
            height: "var(--cl-tap)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--cl-text)",
          }}
        >
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
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div style={{ fontSize: 13, color: "var(--cl-text-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>
          {away.abbreviation} at {home.abbreviation} · <LocalTime iso={gameDate} mode="date" />
        </div>
      </div>

      <section
        aria-label={`${away.name} at ${home.name}`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          alignItems: "center",
          textAlign: "center",
          padding: "8px 0",
        }}
      >
        <TeamBlock team={away} color={colors?.away} side="away" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          {center.kind === "time" ? (
            <LocalTime
              iso={gameDate}
              style={{ fontFamily: "var(--cl-font-display)", fontSize: 26, lineHeight: 1.1, color: "var(--cl-accent)" }}
            />
          ) : (
            <div
              style={{ fontFamily: "var(--cl-font-display)", fontSize: 34, lineHeight: 1, color: "var(--cl-accent)" }}
              aria-label={center.kind === "score" ? `Score ${center.top}` : center.bottom}
            >
              {center.top}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--cl-text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {center.kind === "time" && !center.bottom ? "First pitch" : center.bottom}
          </div>
        </div>
        <TeamBlock team={home} color={colors?.home} side="home" />
      </section>

      {statusLine ? (
        <p role="status" style={{ textAlign: "center", fontSize: 14, color: "var(--cl-text-muted)" }}>
          {statusLine}
        </p>
      ) : null}
    </header>
  );
}
