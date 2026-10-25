import { PollCard } from "@/components/poll-card";
import type { PollView } from "@/lib/polls/rules";
import { createClient } from "@/lib/supabase/server";

interface PollListProps {
  /** Polls tagged to this game only (game page); otherwise the active set. */
  gameId?: number;
  /** How many active polls to show when no game is given (default 5). */
  limit?: number;
  /** Shown when there are no polls; omit to render nothing. */
  emptyText?: string;
  /** Link each question to its poll page. */
  linkToPoll?: boolean;
}

/**
 * Server component: open polls (soonest to close first) plus any that
 * closed in the last 24 hours, through `active_polls`; or every visible
 * poll for one game through `game_polls`. Feed (U7) and the game page (U8)
 * drop this in; it renders nothing when there are no polls and no
 * `emptyText`.
 */
export async function PollList({ gameId, limit = 5, emptyText, linkToPoll = true }: PollListProps) {
  const supabase = await createClient();
  const [{ data, error }, { data: role }] = await Promise.all([
    typeof gameId === "number"
      ? supabase.rpc("game_polls", { p_game_id: gameId })
      : supabase.rpc("active_polls", { p_limit: limit }),
    supabase.rpc("my_role"),
  ]);
  const staff = role === "mod" || role === "admin";
  const polls = ((data ?? []) as PollView[]).filter((p) => p && Array.isArray(p.options));

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--cl-text-muted)", fontSize: 14 }}>
        Couldn&apos;t load polls right now.
      </p>
    );
  }
  if (polls.length === 0) {
    return emptyText ? <p style={{ color: "var(--cl-text-muted)", fontSize: 15 }}>{emptyText}</p> : null;
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {polls.map((p) => (
        <PollCard key={p.id} poll={p} staff={staff} linkToPoll={linkToPoll} />
      ))}
    </div>
  );
}
