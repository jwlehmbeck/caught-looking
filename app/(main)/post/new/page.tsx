import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ShareLinkForm, type TeamOption } from "@/components/feed/share-link-form";
import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Share a clip" };
export const dynamic = "force-dynamic";

/**
 * Share something to the feed. v1 of this page has one tab, "Share a link"
 * (MLB.com or YouTube). U11 adds the "Upload a fan edit" tab in the slot
 * marked below.
 */
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");

  const params = await searchParams;
  const tab = params.tab === "upload" ? "upload" : "link";

  const [{ data: teamRows }, { data: profile }] = await Promise.all([
    supabase.from("teams").select("id, abbreviation, name, city").order("city"),
    supabase.from("profiles").select("favorite_team_id").eq("id", viewerId).maybeSingle(),
  ]);
  const teams = (teamRows ?? []) as TeamOption[];
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
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>Links to MLB.com and YouTube only. Nothing plays in the app.</p>
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
        /* U11 slot: the fan-edit uploader (components/uploader/) mounts here. */
        <section
          aria-label="Upload a fan edit"
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--cl-text-muted)",
            background: "var(--cl-bg-raised)",
            border: "1px solid var(--cl-border)",
            borderRadius: "var(--cl-radius)",
          }}
        >
          Fan edit uploads are coming soon.
        </section>
      )}
    </main>
  );
}
