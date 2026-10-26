import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";

import { fetchProfileOverview } from "./overview";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

const linkButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "var(--cl-tap)",
  padding: "0 14px",
  borderRadius: "var(--cl-radius-pill)",
  border: "1px solid var(--cl-border-strong)",
  color: "var(--cl-text)",
  fontSize: 14,
  fontWeight: 500,
};

/** The signed-in fan's own profile: stats, badges, and a way into Settings. */
export default async function OwnProfilePage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const profile = await fetchProfileOverview(supabase, { userId });

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>

      <SanctionBanner />

      {profile ? (
        <ProfileView
          profile={profile}
          actions={
            <>
              <Link href="/profile/uploads" style={linkButton}>
                My uploads
              </Link>
              <Link href="/profile/settings" style={linkButton}>
                Settings
              </Link>
            </>
          }
        />
      ) : (
        <p role="alert" style={{ color: "var(--cl-text-muted)" }}>
          Couldn&apos;t load your profile right now. Try again in a moment.
        </p>
      )}

      <p style={{ fontSize: 14 }}>
        <Link href="/leaderboard" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          See the season leaderboard →
        </Link>
      </p>
    </main>
  );
}
