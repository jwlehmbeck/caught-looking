"use server";

import { createClient } from "@/lib/supabase/server";

export type PickError = "locked" | "suspended" | "other";

export type MakePickResult = { ok: true; teamId: number; pickedAt: string } | { ok: false; error: PickError };

export interface PickSplit {
  home: number;
  away: number;
  total: number;
}

/**
 * Makes or changes the signed-in user's pick through the `make_pick` RPC.
 * The database enforces the lock (trigger + RPC), so a late tap comes back
 * as `locked` no matter what the screen showed.
 */
export async function makePick(gameId: number, teamId: number): Promise<MakePickResult> {
  if (!Number.isInteger(gameId) || !Number.isInteger(teamId)) {
    return { ok: false, error: "other" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("make_pick", { p_game_id: gameId, p_team_id: teamId });

  if (error) {
    if (error.code === "P0001") return { ok: false, error: "locked" };
    if (error.code === "42501" && /suspended/i.test(error.message)) return { ok: false, error: "suspended" };
    if (error.code === "42501") return { ok: false, error: "other" };
    return { ok: false, error: "other" };
  }

  const row = data as { team_id?: number; picked_at?: string } | null;
  return {
    ok: true,
    teamId: typeof row?.team_id === "number" ? row.team_id : teamId,
    pickedAt: typeof row?.picked_at === "string" ? row.picked_at : new Date().toISOString(),
  };
}

/**
 * The fan split for a game. The RPC returns no row until the viewer has
 * picked (or the game has locked), in which case this resolves to null.
 */
export async function getPickSplit(gameId: number): Promise<PickSplit | null> {
  if (!Number.isInteger(gameId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pick_split", { p_game_id: gameId });
  if (error) return null;
  const rows = (data ?? []) as { home_count: number; away_count: number; total: number }[];
  const row = rows[0];
  if (!row) return null;
  return { home: row.home_count, away: row.away_count, total: row.total };
}
