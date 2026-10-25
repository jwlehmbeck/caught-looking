import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { NewPollForm, type TeamOption } from "./new-poll-form";

export const metadata: Metadata = { title: "New poll" };
export const dynamic = "force-dynamic";

/** Staff-only: mods and admins write the poll; everyone else is sent back. */
export default async function NewPollPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");
  const { data: role } = await supabase.rpc("my_role");
  if (role !== "mod" && role !== "admin") redirect("/polls");

  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, name, city")
    .order("city", { ascending: true });

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/polls" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← All polls
        </Link>
      </nav>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 30 }}>New poll</h1>
        <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>
          A question, 2 to 4 options, and when it closes. Everything runs through the filter first.
        </p>
      </header>
      <NewPollForm teams={(teams ?? []) as TeamOption[]} />
    </main>
  );
}
