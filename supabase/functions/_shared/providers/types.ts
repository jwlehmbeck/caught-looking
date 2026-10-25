/**
 * Provider-neutral sports data contracts.
 *
 * Nothing outside `providers/<name>/` may know a provider's ids, status
 * letters or JSON shapes. The app reads only its own `games` table; the
 * poller is the single consumer of a `SportsProvider`.
 */

export type ProviderSeasonType = "spring" | "regular" | "allstar" | "postseason" | "other";

/**
 * Neutral game status. The domain state machine (domain/game-state.ts) turns
 * this into an `app_state`; it never looks at raw provider codes.
 */
export type ProviderGameStatus =
  | "scheduled"
  | "pregame"
  | "live"
  | "suspended"
  | "final"
  | "tied"
  | "postponed"
  | "cancelled";

export interface ProviderGame {
  /** Opaque provider identifier (MLB: gamePk as a string). */
  providerGameId: string;
  season: number;
  seasonType: ProviderSeasonType;
  /** The provider's "game day" (YYYY-MM-DD); MLB's officialDate. */
  officialDate: string;
  /** Scheduled first pitch, ISO 8601 in UTC. */
  gameDate: string;
  startTimeTbd: boolean;
  status: ProviderGameStatus;
  /** Human-readable provider status, kept for display and debugging. */
  detailedState: string;
  /** Raw provider status code (MLB: codedGameState), stored for audit. */
  codedState: string | null;
  /** Team abbreviations as used by OUR teams table (e.g. ARI, OAK). */
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  /** N = single game, Y = traditional doubleheader, S = split doubleheader. */
  doubleHeader: "N" | "Y" | "S";
  gameNumber: number;
  rescheduledFrom: string | null;
  resumeDate: string | null;
}

export interface ProviderHighlight {
  title: string;
  /** A page on the provider's own site (https://www.mlb.com/...), never a media file. */
  url: string;
  durationSeconds?: number;
}

export interface SportsProvider {
  /** All games with an officialDate between the two YYYY-MM-DD dates, inclusive. */
  schedule(startDate: string, endDate: string): Promise<ProviderGame[]>;
  /** Fresh status and scores for the given games. */
  linescores(providerGameIds: string[]): Promise<ProviderGame[]>;
  /** Highlight page links for a (usually final) game. */
  highlights(providerGameId: string): Promise<ProviderHighlight[]>;
}
