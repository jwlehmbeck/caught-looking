/**
 * Turns a provider snapshot into the row the poller writes to public.games.
 * Pure, so the poller's decisions are unit-testable without a database.
 */

import type { ProviderGame, ProviderHighlight } from "../providers/types.ts";
import { type AppState, deriveAppState, reopensPicks, resolveLockAt } from "./game-state.ts";

/** The columns the poller reads back before deciding. */
export interface ExistingGameRow {
  app_state: AppState;
  lock_at: string;
  highlights: unknown;
}

export interface GameRowUpdate {
  provider: string;
  provider_game_id: string;
  season: number;
  season_type: ProviderGame["seasonType"];
  official_date: string;
  game_date: string;
  start_time_tbd: boolean;
  coded_state: string | null;
  detailed_state: string;
  app_state: AppState;
  lock_at: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  double_header: "N" | "Y" | "S";
  game_number: number;
  rescheduled_from: string | null;
  resume_date: string | null;
  ended_at?: string;
  highlights?: ProviderHighlight[];
  updated_at: string;
}

export type PlanResult =
  | { kind: "upsert"; row: GameRowUpdate; prevState: AppState | null; reopened: boolean }
  | { kind: "skip"; reason: string };

export interface PlanInput {
  provider: string;
  game: ProviderGame;
  existing: ExistingGameRow | null;
  teamIds: ReadonlyMap<string, number>;
  highlights?: ProviderHighlight[];
  now: Date;
}

export function planGameUpdate(input: PlanInput): PlanResult {
  const { game, existing, now } = input;
  const homeId = input.teamIds.get(game.homeTeam);
  const awayId = input.teamIds.get(game.awayTeam);
  if (homeId === undefined || awayId === undefined) {
    // Spring games against colleges or split squads with unknown codes.
    return { kind: "skip", reason: `unknown team ${game.awayTeam} @ ${game.homeTeam}` };
  }
  if (homeId === awayId) {
    return { kind: "skip", reason: `same team on both sides (${game.homeTeam})` };
  }

  const prevState = existing?.app_state ?? null;
  const nextState = deriveAppState(prevState, game, now);
  const lockAt = resolveLockAt({
    game,
    prevState,
    prevLockAt: existing?.lock_at ? new Date(existing.lock_at) : null,
    nextState,
    now,
  });

  const row: GameRowUpdate = {
    provider: input.provider,
    provider_game_id: game.providerGameId,
    season: game.season,
    season_type: game.seasonType,
    official_date: game.officialDate,
    game_date: game.gameDate,
    start_time_tbd: game.startTimeTbd,
    coded_state: game.codedState,
    detailed_state: game.detailedState,
    app_state: nextState,
    lock_at: lockAt.toISOString(),
    home_team_id: homeId,
    away_team_id: awayId,
    home_score: game.homeScore,
    away_score: game.awayScore,
    double_header: game.doubleHeader,
    game_number: game.gameNumber,
    rescheduled_from: game.rescheduledFrom,
    resume_date: game.resumeDate,
    updated_at: now.toISOString(),
  };

  const isDone = nextState === "final" || nextState === "scored";
  if (isDone && prevState !== "final" && prevState !== "scored") {
    row.ended_at = now.toISOString();
  }
  if (isDone && input.highlights && input.highlights.length > 0) {
    row.highlights = input.highlights;
  }

  return { kind: "upsert", row, prevState, reopened: reopensPicks(prevState, nextState) };
}
