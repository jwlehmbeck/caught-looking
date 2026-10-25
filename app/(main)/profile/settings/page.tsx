import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";

import { DeleteAccountSection, LogoutSection, RecoveryCodeSection } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

interface ProfileRow {
  username: string;
  created_at: string;
  teams: { abbreviation: string; name: string } | null;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("username, created_at, teams:favorite_team_id (abbreviation, name)")
    .eq("id", userId)
    .maybeSingle();
  const profile = data as unknown as ProfileRow | null;

  return (
    <main className="cl-shell" style={{ paddingTop: 40, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>
      <h1 style={{ fontSize: 30 }}>Settings</h1>

      <SanctionBanner />

      <section
        aria-labelledby="account-heading"
        style={{
          background: "var(--cl-bg-card)",
          border: "1px solid var(--cl-border)",
          borderRadius: "var(--cl-radius)",
          padding: 20,
          display: "grid",
          gap: 8,
        }}
      >
        <h2 id="account-heading" style={{ fontSize: 22 }}>
          Account
        </h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: 15 }}>
          <dt style={{ color: "var(--cl-text-muted)" }}>Username</dt>
          <dd>{profile?.username ?? "—"}</dd>
          <dt style={{ color: "var(--cl-text-muted)" }}>Team</dt>
          <dd>{profile?.teams ? `${profile.teams.abbreviation} · ${profile.teams.name}` : "—"}</dd>
          <dt style={{ color: "var(--cl-text-muted)" }}>Member since</dt>
          <dd>{profile ? new Date(profile.created_at).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"}</dd>
        </dl>
        <p style={{ fontSize: 13, color: "var(--cl-text-muted)" }}>
          We don&apos;t keep an email, phone number or real name for you. Only your birth year.
        </p>
      </section>

      <RecoveryCodeSection />
      <LogoutSection />
      <DeleteAccountSection />
    </main>
  );
}
