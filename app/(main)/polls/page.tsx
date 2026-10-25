import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PollList } from "@/components/poll-list";
import { SanctionBanner } from "@/components/sanction-banner";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Polls" };
export const dynamic = "force-dynamic";

/** Rivalry polls: open ones first, then anything that closed in the last day. */
export default async function PollsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");
  const { data: role } = await supabase.rpc("my_role");
  const staff = role === "mod" || role === "admin";

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← Home
        </Link>
      </nav>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 30 }}>Rivalry polls</h1>
          <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>Vote once. Results show after you vote.</p>
        </div>
        {staff ? (
          <Link
            href="/polls/new"
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
              whiteSpace: "nowrap",
            }}
          >
            New poll
          </Link>
        ) : null}
      </header>

      <SanctionBanner />

      <PollList limit={20} emptyText="No polls right now. Check back after the next game." />
    </main>
  );
}
