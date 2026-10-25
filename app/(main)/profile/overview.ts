import type { SupabaseClient } from "@supabase/supabase-js";

import type { BadgeView } from "@/components/badge-grid";

export interface StatsView {
  picks_scored: number;
  picks_correct: number;
  current_streak: number;
  best_streak: number;
  game_day_streak: number;
}

/** Shape of the `profile_overview` RPC's jsonb result. */
export interface ProfileOverview {
  id: string;
  username: string;
  created_at: string;
  is_self: boolean;
  team: { id: number; abbreviation: string; name: string; city: string } | null;
  season: number;
  season_stats: StatsView;
  lifetime_stats: StatsView;
  season_rank: number | null;
  season_rank_tied: boolean;
  badges: BadgeView[];
}

/**
 * Loads a profile through the `profile_overview` RPC as the viewer. Returns
 * null for deleted profiles, unknown usernames and people the viewer has
 * blocked (the database decides, not the page).
 */
export async function fetchProfileOverview(
  supabase: SupabaseClient,
  by: { userId: string } | { username: string },
): Promise<ProfileOverview | null> {
  const args = "userId" in by ? { p_user_id: by.userId, p_username: null } : { p_user_id: null, p_username: by.username };
  const { data, error } = await supabase.rpc("profile_overview", args);
  if (error || !data) return null;
  return data as ProfileOverview;
}
