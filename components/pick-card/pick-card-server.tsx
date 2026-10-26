import { createClient } from "@/lib/supabase/server";
import type { AppState } from "@shared/domain/game-state.ts";

import { PickCard, type PickCardGame, type PickCardTeam, type ViewerPick } from "./pick-card";

interface TeamRow {
  id: number;
  abbreviation: string;
  name: string;
  color_primary: string;
}

export interface GameRow {
  id: number;
  app_state: AppState;
  lock_at: string;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: number | null;
  counts_for_picks: boolean;
  home: TeamRow | null;
  away: TeamRow | null;
}

export const GAME_SELECT =
  "id, app_state, lock_at, game_date, home_team_id, away_team_id, home_score, away_score, winner_team_id, counts_for_picks, " +
  "home:teams!games_home_team_id_fkey (id, abbreviation, name, color_primary), " +
  "away:teams!games_away_team_id_fkey (id, abbreviation, name, color_primary)";

function toTeam(row: TeamRow): PickCardTeam {
  return { id: row.id, abbreviation: row.abbreviation, name: row.name, color: row.color_primary };
}

export function toPickCardGame(row: GameRow): PickCardGame | null {
  if (!row.home || !row.away) return null;
  return {
    id: row.id,
    appState: row.app_state,
    lockAt: row.lock_at,
    gameDate: row.game_date,
    home: toTeam(row.home),
    away: toTeam(row.away),
    homeScore: row.home_score,
    awayScore: row.away_score,
    winnerTeamId: row.winner_team_id,
    countsForPicks: row.counts_for_picks,
  };
}

/**
 * Loads a game, the viewer's pick and (when allowed) the fan split, and
 * renders the client pick card. Pass either `gameId` or an already-loaded
 * `game` row (with the team joins from GAME_SELECT) to save a query.
 */
export async function PickCardServer({
  gameId,
  game: preloaded,
  openTitle,
  emphasis,
}: {
  gameId?: number;
  game?: GameRow;
  openTitle?: string;
  emphasis?: boolean;
}) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return null;

  let row: GameRow | null = preloaded ?? null;
  if (!row && typeof gameId === "number") {
    const { data } = await supabase.from("games").select(GAME_SELECT).eq("id", gameId).maybeSingle();
    row = (data as unknown as GameRow | null) ?? null;
  }
  if (!row) return null;
  const game = toPickCardGame(row);
  if (!game) return null;

  const [pickRes, splitRes] = await Promise.all([
    supabase.from("picks").select("team_id, status").eq("game_id", game.id).eq("user_id", userId).maybeSingle(),
    supabase.rpc("pick_split", { p_game_id: game.id }),
  ]);

  const pickRow = pickRes.data as { team_id: number; status: ViewerPick["status"] } | null;
  const initialPick: ViewerPick | null = pickRow ? { teamId: pickRow.team_id, status: pickRow.status } : null;

  const splitRows = (splitRes.data ?? []) as { home_count: number; away_count: number; total: number }[];
  const initialSplit = splitRows[0]
    ? { home: splitRows[0].home_count, away: splitRows[0].away_count, total: splitRows[0].total }
    : null;

  return (
    <PickCard game={game} initialPick={initialPick} initialSplit={initialSplit} openTitle={openTitle} emphasis={emphasis} />
  );
}
