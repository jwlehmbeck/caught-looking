import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PollCard } from "@/components/poll-card";
import { SanctionBanner } from "@/components/sanction-banner";
import type { PollView } from "@/lib/polls/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Poll" };
export const dynamic = "force-dynamic";

/** One poll with its results (once the viewer voted or it closed). */
export default async function PollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0 || !/^\d+$/.test(raw)) notFound();

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");

  const [{ data, error }, { data: role }] = await Promise.all([
    supabase.rpc("poll_results", { p_poll_id: id }),
    supabase.rpc("my_role"),
  ]);
  if (error) throw new Error("Couldn't load this poll.");
  const poll = data as PollView | null;
  if (!poll || !Array.isArray(poll.options)) notFound();
  const staff = role === "mod" || role === "admin";

  return (
    <main className="cl-shell" style={{ paddingTop: 32, paddingBottom: 48, display: "grid", gap: 20 }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 14, color: "var(--cl-text-muted)" }}>
        <Link href="/polls" style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)" }}>
          ← All polls
        </Link>
      </nav>

      <SanctionBanner />

      {poll.status === "hidden" ? (
        <p role="status" style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
          This poll is hidden. Only mods and admins can see it.
        </p>
      ) : null}

      <PollCard poll={poll} staff={staff} />

      {poll.game_id ? (
        <Link href={`/game/${poll.game_id}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "var(--cl-tap)", fontWeight: 700 }}>
          Go to the game →
        </Link>
      ) : null}
    </main>
  );
}
