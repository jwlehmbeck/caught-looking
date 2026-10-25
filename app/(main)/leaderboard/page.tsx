import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";
import {
  FANBASE_MIN_USERS,
  LEADERBOARD_MIN_ACCOUNT_DAYS,
  LEADERBOARD_MIN_PICKS,
  rankLabel,
} from "@shared/domain/leaderboard.ts";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

type Tab = "people" | "fanbases";
const PAGE_SIZE = 50;

interface PersonRow {
  rank: number;
  tied: boolean;
  user_id: string;
  username: string;
  favorite_team_id: number | null;
  team_abbreviation: string | null;
  picks_scored: number;
  picks_correct: number;
  hit_rate: number | string;
}

interface FanBaseRow {
  rank: number;
  tied: boolean;
  team_id: number;
  team_abbreviation: string;
  team_name: string;
  qualified_users: number;
  picks_scored: number;
  picks_correct: number;
  hit_rate: number | string;
}

interface MyRank {
  season: number;
  rank: number | null;
  tied: boolean;
  picks_scored: number;
  picks_correct: number;
  picks_needed: number;
  days_needed: number;
  qualified: boolean;
}

const card: React.CSSProperties = {
  background: "var(--cl-bg-card)",
  border: "1px solid var(--cl-border)",
  borderRadius: "var(--cl-radius)",
  overflow: "hidden",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 12,
  minHeight: 56,
  padding: "8px 16px",
  borderTop: "1px solid var(--cl-border)",
};

function pct(rate: number | string): string {
  return `${Math.round(Number(rate) * 100)}%`;
}

function RankCell({ rank, tied }: { rank: number; tied: boolean }) {
  const label = rankLabel(rank, tied);
  return (
    <span
      aria-label={tied ? `Tied for ${rank}` : `Rank ${rank}`}
      style={{
        fontFamily: "var(--cl-font-display)",
        fontSize: label.length > 3 ? 16 : 22,
        color: rank <= 3 ? "var(--cl-accent)" : "var(--cl-text)",
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
  );
}

function Tabs({ active }: { active: Tab }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "people", label: "People" },
    { id: "fanbases", label: "Fan bases" },
  ];
  return (
    <nav aria-label="Leaderboard" style={{ display: "flex", gap: 8 }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={`/leaderboard?tab=${t.id}`}
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

function YouRow({ me, username }: { me: MyRank | null; username: string | null }) {
  if (!me) return null;
  let status: string;
  if (me.rank !== null) {
    status = `${pct(me.picks_scored ? me.picks_correct / me.picks_scored : 0)} · ${me.picks_correct} of ${me.picks_scored} right`;
  } else if (me.picks_needed > 0) {
    status = `${me.picks_needed} more scored ${me.picks_needed === 1 ? "pick" : "picks"} to qualify`;
    if (me.days_needed > 0) status += ` · account must be ${LEADERBOARD_MIN_ACCOUNT_DAYS} days old`;
  } else if (me.days_needed > 0) {
    status = `${me.days_needed} more ${me.days_needed === 1 ? "day" : "days"} until you're ranked`;
  } else {
    status = "You'll appear after the next scoring run";
  }
  return (
    <section
      aria-label="Your standing"
      style={{
        ...rowStyle,
        borderTop: 0,
        border: "1px solid var(--cl-accent)",
        borderRadius: "var(--cl-radius)",
        background: "var(--cl-bg-raised)",
      }}
    >
      {me.rank !== null ? (
        <RankCell rank={me.rank} tied={me.tied} />
      ) : (
        <span aria-hidden="true" style={{ color: "var(--cl-text-muted)", fontSize: 22 }}>
          —
        </span>
      )}
      <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <span style={{ fontWeight: 700 }}>
          You{username ? ` · ${username}` : ""}
        </span>
        <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>{status}</span>
      </div>
      {me.rank === null ? (
        <Link href="/picks" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)", fontSize: 14, fontWeight: 700 }}>
          Pick →
        </Link>
      ) : (
        <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 22 }}>{pct(me.picks_scored ? me.picks_correct / me.picks_scored : 0)}</span>
      )}
    </section>
  );
}

/**
 * Season leaderboards: People (25+ scored picks, account 3+ days old) and
 * Fan bases (pooled picks of qualified fans per team, 5+ per team). Ties
 * share a rank and show as "T-3". The viewer's own row is pinned on top
 * whether or not they qualify yet.
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");

  const params = await searchParams;
  const tab: Tab = params.tab === "fanbases" ? "fanbases" : "people";
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  const [seasonRes, meRes, profileRes] = await Promise.all([
    supabase.rpc("current_season"),
    supabase.rpc("my_rank", { p_season: null }),
    supabase.from("profiles").select("username").eq("id", viewerId).maybeSingle(),
  ]);
  const season = typeof seasonRes.data === "number" ? seasonRes.data : new Date().getFullYear();
  const me = (Array.isArray(meRes.data) ? meRes.data[0] : meRes.data) as MyRank | null | undefined;
  const username = (profileRes.data as { username: string } | null)?.username ?? null;

  let people: PersonRow[] = [];
  let fanbases: FanBaseRow[] = [];
  let loadError = false;
  if (tab === "people") {
    const { data, error } = await supabase.rpc("season_leaderboard", {
      p_season: season,
      p_limit: PAGE_SIZE + 1,
      p_offset: page * PAGE_SIZE,
    });
    loadError = Boolean(error);
    people = (data ?? []) as PersonRow[];
  } else {
    const { data, error } = await supabase.rpc("fanbase_leaderboard", { p_season: season });
    loadError = Boolean(error);
    fanbases = (data ?? []) as FanBaseRow[];
  }
  const hasMore = people.length > PAGE_SIZE;
  if (hasMore) people = people.slice(0, PAGE_SIZE);

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>

      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 30 }}>Leaderboard</h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>{season} season · ranked by hit rate, then picks right</p>
      </header>

      <SanctionBanner />
      <Tabs active={tab} />
      <YouRow me={me ?? null} username={username} />

      {loadError ? (
        <p role="alert" style={{ color: "var(--cl-text-muted)" }}>
          Couldn&apos;t load the leaderboard. Try again in a moment.
        </p>
      ) : null}

      {tab === "people" ? (
        <section aria-labelledby="people-heading" style={card}>
          <h2 id="people-heading" style={{ fontSize: 18, padding: "14px 16px 6px" }}>
            Top predictors
          </h2>
          {people.length === 0 && !loadError ? (
            <p style={{ padding: "8px 16px 18px", color: "var(--cl-text-muted)", fontSize: 15 }}>
              Nobody is ranked yet. The board opens once fans have {LEADERBOARD_MIN_PICKS} scored picks this season.
            </p>
          ) : (
            <ol style={{ listStyle: "none" }}>
              {people.map((r) => {
                const self = r.user_id === viewerId;
                return (
                  <li key={r.user_id} style={{ ...rowStyle, background: self ? "var(--cl-bg-raised)" : undefined }}>
                    <RankCell rank={r.rank} tied={r.tied} />
                    <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                      <Link
                        href={self ? "/profile" : `/profile/${encodeURIComponent(r.username)}`}
                        style={{
                          color: "var(--cl-text)",
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: "var(--cl-tap)",
                        }}
                      >
                        {r.username}
                        {self ? " (you)" : ""}
                      </Link>
                      <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
                        {r.team_abbreviation ? `${r.team_abbreviation} · ` : ""}
                        {r.picks_correct} of {r.picks_scored} right
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 22, letterSpacing: 0.5 }}>{pct(r.hit_rate)}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {(page > 0 || hasMore) && (
            <nav aria-label="More of the board" style={{ display: "flex", justifyContent: "space-between", padding: "4px 16px 12px", fontSize: 14 }}>
              {page > 0 ? (
                <Link href={`/leaderboard?tab=people&page=${page - 1}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              {hasMore ? (
                <Link href={`/leaderboard?tab=people&page=${page + 1}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
                  Next →
                </Link>
              ) : null}
            </nav>
          )}
        </section>
      ) : (
        <section aria-labelledby="fanbases-heading" style={card}>
          <h2 id="fanbases-heading" style={{ fontSize: 18, padding: "14px 16px 6px" }}>
            Fan bases
          </h2>
          <p style={{ padding: "0 16px 10px", color: "var(--cl-text-muted)", fontSize: 13 }}>
            Every ranked fan&apos;s picks, pooled by favorite team. A team needs {FANBASE_MIN_USERS} ranked fans to show.
          </p>
          {fanbases.length === 0 && !loadError ? (
            <p style={{ padding: "0 16px 18px", color: "var(--cl-text-muted)", fontSize: 15 }}>
              No fan base has {FANBASE_MIN_USERS} ranked fans yet. Recruit your people.
            </p>
          ) : (
            <ol style={{ listStyle: "none" }}>
              {fanbases.map((t) => (
                <li key={t.team_id} style={rowStyle}>
                  <RankCell rank={t.rank} tied={t.tied} />
                  <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                    <span style={{ fontWeight: 700 }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 8px",
                          marginRight: 8,
                          borderRadius: 6,
                          border: "1px solid var(--cl-border-strong)",
                          fontSize: 13,
                        }}
                      >
                        {t.team_abbreviation}
                      </span>
                      {t.team_name}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
                      {t.qualified_users} fans · {t.picks_correct} of {t.picks_scored} right
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--cl-font-display)", fontSize: 22, letterSpacing: 0.5 }}>{pct(t.hit_rate)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <p style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
        To be ranked: {LEADERBOARD_MIN_PICKS} scored picks this season and an account at least {LEADERBOARD_MIN_ACCOUNT_DAYS} days old.
        Boards update after each scoring run.
      </p>
    </main>
  );
}
