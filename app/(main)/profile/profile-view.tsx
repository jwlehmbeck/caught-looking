import Link from "next/link";

import { BadgeGrid } from "@/components/badge-grid";
import { HitRateChip } from "@/components/hit-rate-chip";
import { rankLabel } from "@shared/domain/leaderboard.ts";
import { hitRateUnlocked } from "@shared/domain/scoring.ts";

import type { ProfileOverview } from "./overview";

const card: React.CSSProperties = {
  background: "var(--cl-bg-card)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  padding: 20,
  display: "grid",
  gap: 12,
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <dt style={{ fontSize: 12, color: "var(--cl-text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</dt>
      <dd style={{ fontFamily: "var(--cl-font-display)", fontSize: 24, letterSpacing: 0.5 }}>{value}</dd>
    </div>
  );
}

/**
 * The profile body shared by the own-profile and other-user pages: name and
 * team, season hit-rate chip (or the unlock counter), lifetime hit rate,
 * streaks and the badge grid. No photos anywhere; `actions` is where the
 * caller drops Report / Block or the Settings link.
 */
export function ProfileView({ profile, actions }: { profile: ProfileOverview; actions?: React.ReactNode }) {
  const season = profile.season_stats;
  const lifetime = profile.lifetime_stats;
  const memberSince = new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header style={{ ...card, gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <h1 style={{ fontSize: 32, overflowWrap: "anywhere" }}>{profile.username}</h1>
            <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
              {profile.team ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 8px",
                      marginRight: 8,
                      borderRadius: 6,
                      border: "1px solid var(--cl-border-strong)",
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--cl-text)",
                    }}
                  >
                    {profile.team.abbreviation}
                  </span>
                  {profile.team.city} {profile.team.name} fan
                </>
              ) : (
                "No favorite team yet"
              )}
              {" · "}since {memberSince}
            </p>
          </div>
          {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div> : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <HitRateChip stats={season} scope={`${profile.season} season`} size="lg" />
          {profile.season_rank !== null ? (
            <Link
              href="/leaderboard"
              style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)", fontSize: 14, fontWeight: 700 }}
            >
              #{rankLabel(profile.season_rank, profile.season_rank_tied)} this season →
            </Link>
          ) : null}
        </div>
      </header>

      <section aria-labelledby="stats-heading" style={card}>
        <h2 id="stats-heading" style={{ fontSize: 22 }}>
          {profile.season} season
        </h2>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <Stat label="Picks" value={season.picks_scored} />
          <Stat label="Right" value={season.picks_correct} />
          <Stat label="Streak" value={season.current_streak} />
          <Stat label="Best streak" value={season.best_streak} />
          <Stat label="Game days" value={season.game_day_streak} />
          <Stat label="Lifetime" value={hitRateUnlocked(lifetime) ? `${Math.round((lifetime.picks_correct / lifetime.picks_scored) * 100)}%` : "—"} />
        </dl>
        <p style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          Lifetime: {lifetime.picks_correct} of {lifetime.picks_scored} picks right
          {hitRateUnlocked(lifetime) ? "" : ` · ${lifetime.picks_scored} of 10 picks to unlock the lifetime rate`}.
        </p>
      </section>

      <BadgeGrid badges={profile.badges} />
    </div>
  );
}
