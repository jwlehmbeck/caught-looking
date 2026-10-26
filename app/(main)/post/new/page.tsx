import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ShareLinkForm, type TeamOption } from "@/components/feed/share-link-form";
import { SanctionBanner } from "@/components/sanction-banner";
import { Uploader, type UploaderGame } from "@/components/uploader/uploader";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Share a clip" };
export const dynamic = "force-dynamic";

interface GameRow {
  id: number;
  official_date: string;
  home_team_id: number;
  away_team_id: number;
}

/** Games from the last three days are offered as the optional game tag. */
function recentSince(): string {
  return new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Share something to the feed: a link (MLB.com or YouTube) or a fan edit
 * upload (U11), which goes through scanning and an adult's approval before
 * anyone sees it.
 */
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");

  const params = await searchParams;
  const tab = params.tab === "upload" ? "upload" : "link";

  const [{ data: teamRows }, { data: profile }, { data: gameRows }] = await Promise.all([
    supabase.from("teams").select("id, abbreviation, name, city").order("city"),
    supabase.from("profiles").select("favorite_team_id").eq("id", viewerId).maybeSingle(),
    tab === "upload"
      ? supabase.from("games").select("id, official_date, home_team_id, away_team_id").gte("official_date", recentSince()).order("game_date", { ascending: false }).limit(40)
      : Promise.resolve({ data: null }),
  ]);
  const teams = (teamRows ?? []) as TeamOption[];
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const games: UploaderGame[] = ((gameRows ?? []) as GameRow[]).map((g) => ({
    id: g.id,
    label: `${abbr.get(g.away_team_id) ?? "?"} at ${abbr.get(g.home_team_id) ?? "?"} · ${g.official_date}`,
  }));
  const favoriteTeamId = (profile as { favorite_team_id: number | null } | null)?.favorite_team_id ?? null;

  const pill = (on: boolean): React.CSSProperties => ({
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
  });

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/feed" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Feed
        </Link>
      </nav>

      <SanctionBanner />

      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 30 }}>Share</h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
          {tab === "link" ? "Links to MLB.com and YouTube only. Nothing plays in the app." : "Short edits of your own footage. Every upload is checked before it shows up."}
        </p>
      </header>

      <nav aria-label="What to share" style={{ display: "flex", gap: 8 }}>
        <Link href="/post/new?tab=link" aria-current={tab === "link" ? "page" : undefined} style={pill(tab === "link")}>
          Share a link
        </Link>
        <Link href="/post/new?tab=upload" aria-current={tab === "upload" ? "page" : undefined} style={pill(tab === "upload")}>
          Upload a fan edit
        </Link>
      </nav>

      {tab === "link" ? (
        <ShareLinkForm teams={teams} defaultTeamId={favoriteTeamId} />
      ) : (
        <section aria-label="Upload a fan edit" style={{ display: "grid", gap: 16 }}>
          <aside
            aria-label="Upload rules"
            style={{
              padding: 14,
              background: "var(--cl-bg-raised)",
              border: "1px solid var(--cl-border)",
              borderRadius: "var(--cl-radius)",
              fontSize: 14,
              display: "grid",
              gap: 6,
            }}
          >
            <strong>The rules, short version</strong>
            <ul style={{ paddingLeft: 18, display: "grid", gap: 2 }}>
              <li>Your own footage or a short commentary edit. No copyrighted music.</li>
              <li>No faces of you or your friends, no school names, no locations.</li>
              <li>60 seconds or less, 3 uploads a day. An adult reviews every one.</li>
            </ul>
            <Link href="/rules#uploads" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
              Read the full upload rules →
            </Link>
          </aside>
          <Uploader teams={teams} games={games} defaultTeamId={favoriteTeamId} />
        </section>
      )}
    </main>
  );
}
