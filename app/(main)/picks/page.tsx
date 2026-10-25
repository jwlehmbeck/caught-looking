import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GAME_SELECT, PickCardServer, type GameRow } from "@/components/pick-card/pick-card-server";
import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";
import { addDays, localDate } from "@shared/domain/game-state.ts";

export const metadata: Metadata = { title: "Picks" };
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function startTime(gameDate: string): string {
  return new Date(gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Today's games with a pick card each. A working screen for U5; U7 builds
 * the real home feed around the same card. `?date=YYYY-MM-DD` shows another
 * day (handy with fixture replays).
 */
export default async function PicksPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");

  const params = await searchParams;
  const today = localDate(new Date(), "America/New_York");
  const date = params.date && DATE_RE.test(params.date) ? params.date : today;

  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("official_date", date)
    .order("game_date", { ascending: true })
    .order("id", { ascending: true });
  const games = ((data ?? []) as unknown as GameRow[]).filter((g) => g.home && g.away);

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>

      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 30 }}>Picks</h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>{formatDay(date)}</p>
        <nav aria-label="Change day" style={{ display: "flex", gap: 16, fontSize: 14, marginTop: 4 }}>
          <Link href={`/picks?date=${addDays(date, -1)}`} style={{ minHeight: "var(--cl-tap)", display: "inline-flex", alignItems: "center" }}>
            ← Previous day
          </Link>
          {date !== today ? (
            <Link href="/picks" style={{ minHeight: "var(--cl-tap)", display: "inline-flex", alignItems: "center" }}>
              Today
            </Link>
          ) : null}
          <Link href={`/picks?date=${addDays(date, 1)}`} style={{ minHeight: "var(--cl-tap)", display: "inline-flex", alignItems: "center" }}>
            Next day →
          </Link>
        </nav>
      </header>

      <SanctionBanner />

      {error ? (
        <p role="alert" style={{ color: "var(--cl-text-muted)" }}>
          Couldn&apos;t load today&apos;s games. Pull to refresh in a moment.
        </p>
      ) : null}

      {!error && games.length === 0 ? (
        <section
          style={{
            background: "var(--cl-bg-card)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius)",
            padding: 20,
            display: "grid",
            gap: 6,
          }}
        >
          <h2 style={{ fontSize: 22 }}>No games today</h2>
          <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
            Off day. Check back when the schedule picks up.
          </p>
        </section>
      ) : null}

      {games.map((g) => (
        <article key={g.id} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ fontSize: 18 }}>
              {g.away!.abbreviation} at {g.home!.abbreviation}
            </h2>
            <span style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
              {g.app_state === "open" || g.app_state === "locked" ? startTime(g.game_date) : g.app_state}
              {g.counts_for_picks ? "" : " · doesn't count"}
            </span>
          </div>
          <PickCardServer game={g} />
        </article>
      ))}
    </main>
  );
}
