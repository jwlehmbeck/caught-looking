import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FeedList } from "@/components/feed/feed-list";
import { FeedTabs } from "@/components/feed/feed-tabs";
import { SanctionBanner } from "@/components/sanction-banner";
import { loadFeed } from "@/lib/feed/actions";
import { createClient } from "@/lib/supabase/server";
import { isFeedTab, type FeedTab } from "@shared/domain/hot-score.ts";

export const metadata: Metadata = { title: "Feed" };
export const dynamic = "force-dynamic";

const EMPTY: Record<FeedTab, string> = {
  hot: "Nothing here yet. Share an MLB.com or YouTube clip to get it going.",
  new: "Nothing here yet. Share an MLB.com or YouTube clip to get it going.",
  my_team: "No posts tagged with your team yet.",
};

/**
 * Standalone feed page: Hot / New / My Team with "Load more". U7 folds this
 * into the home screen; the components and actions stay as they are.
 */
export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");

  const params = await searchParams;
  const tab: FeedTab = isFeedTab(params.tab) ? params.tab : "hot";
  const page = await loadFeed(tab, 0);

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>

      <SanctionBanner />

      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 30, flex: 1 }}>Feed</h1>
        <Link
          href="/post/new"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: "var(--cl-tap)",
            padding: "0 16px",
            borderRadius: "var(--cl-radius-pill)",
            background: "var(--cl-accent)",
            color: "var(--cl-on-accent)",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          + Share
        </Link>
      </header>

      <FeedTabs active={tab} />
      <FeedList key={tab} tab={tab} initial={page} emptyMessage={EMPTY[tab]} />

      <p style={{ fontSize: 12, color: "var(--cl-text-muted)", textAlign: "center" }}>
        Clips open on MLB.com or YouTube. Not affiliated with MLB or any club.
      </p>
    </main>
  );
}
