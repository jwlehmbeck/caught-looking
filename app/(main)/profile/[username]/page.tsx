import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BlockButton } from "@/components/block-button";
import { ReportButton } from "@/components/report-button";
import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";

import { fetchProfileOverview } from "../overview";
import { ProfileView } from "../profile-view";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

interface Params {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: USERNAME_RE.test(username) ? username : "Profile" };
}

/**
 * Another fan's profile: username, team, hit rate or unlock counter, badge
 * grid, and Report / Block. Deleted profiles, unknown names and people the
 * viewer has blocked all come back as "not found" — the RPC returns null
 * and the page does not try to tell those apart.
 */
export default async function UserProfilePage({ params }: Params) {
  const { username } = await params;
  if (!USERNAME_RE.test(username)) notFound();

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");

  const profile = await fetchProfileOverview(supabase, { username });
  if (!profile) notFound();
  if (profile.is_self) redirect("/profile");

  // The viewer can read only their own block rows, so this is their list.
  const { data: blockRow } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", viewerId)
    .eq("blocked_id", profile.id)
    .maybeSingle();

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/leaderboard" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Leaderboard
        </Link>
      </nav>

      <SanctionBanner />

      <ProfileView
        profile={profile}
        actions={
          <>
            <ReportButton targetType="profile" targetId={profile.id} label="Report" />
            <BlockButton userId={profile.id} username={profile.username} initiallyBlocked={Boolean(blockRow)} />
          </>
        }
      />
    </main>
  );
}
