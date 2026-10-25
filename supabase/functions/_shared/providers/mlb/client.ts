/**
 * MLB Stats API client. SERVER ONLY: imported by the poll-games Edge Function
 * and by tests, never by anything under app/ or components/.
 *
 * `fetch` is injected so tests can feed recorded fixtures.
 */

import type { ProviderGame, ProviderHighlight, SportsProvider } from "../types.ts";
import { mapHighlights, mapSchedule, type MlbGame, type MlbSchedule } from "./map.ts";

export const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

export const SCHEDULE_HYDRATE = "linescore,team,game(content(highlights(highlights)))";

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface MlbClientOptions {
  fetch: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

export class MlbProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MlbProviderError";
  }
}

export function scheduleUrl(startDate: string, endDate: string, baseUrl = MLB_API_BASE): string {
  const params = new URLSearchParams({
    sportId: "1",
    startDate,
    endDate,
    hydrate: SCHEDULE_HYDRATE,
  });
  return `${baseUrl}/schedule?${params.toString()}`;
}

export function gamesUrl(providerGameIds: string[], baseUrl = MLB_API_BASE): string {
  const params = new URLSearchParams({
    sportId: "1",
    gamePks: providerGameIds.join(","),
    hydrate: SCHEDULE_HYDRATE,
  });
  return `${baseUrl}/schedule?${params.toString()}`;
}

function isSchedule(value: unknown): value is MlbSchedule {
  return typeof value === "object" && value !== null && Array.isArray((value as MlbSchedule).dates);
}

export function createMlbProvider(options: MlbClientOptions): SportsProvider & {
  rawSchedule(startDate: string, endDate: string): Promise<MlbSchedule>;
  rawGames(providerGameIds: string[]): Promise<MlbSchedule>;
} {
  const baseUrl = options.baseUrl ?? MLB_API_BASE;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function getJson(url: string): Promise<MlbSchedule> {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let body: unknown;
    try {
      const res = await options.fetch(url, {
        signal: controller?.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        throw new MlbProviderError(`MLB responded ${res.status} for ${url}`);
      }
      body = await res.json();
    } catch (err) {
      if (err instanceof MlbProviderError) throw err;
      throw new MlbProviderError(`MLB request failed for ${url}`, err);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!isSchedule(body)) {
      throw new MlbProviderError(`MLB returned a malformed schedule for ${url}`);
    }
    return body;
  }

  return {
    rawSchedule: (startDate, endDate) => getJson(scheduleUrl(startDate, endDate, baseUrl)),
    rawGames: (ids) => getJson(gamesUrl(ids, baseUrl)),

    async schedule(startDate: string, endDate: string): Promise<ProviderGame[]> {
      return mapSchedule(await getJson(scheduleUrl(startDate, endDate, baseUrl)));
    },

    async linescores(providerGameIds: string[]): Promise<ProviderGame[]> {
      if (providerGameIds.length === 0) return [];
      return mapSchedule(await getJson(gamesUrl(providerGameIds, baseUrl)));
    },

    async highlights(providerGameId: string): Promise<ProviderHighlight[]> {
      const schedule = await getJson(gamesUrl([providerGameId], baseUrl));
      const game: MlbGame | undefined = (schedule.dates ?? [])
        .flatMap((d) => d.games ?? [])
        .find((g) => String(g.gamePk) === providerGameId);
      return game ? mapHighlights(game) : [];
    },
  };
}
