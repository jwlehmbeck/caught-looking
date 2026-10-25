/**
 * Feed ranking rules (plan U10). Runtime-neutral; mirrored by the `feed`
 * RPC in supabase/migrations/20261025131000_u10_feed.sql. Change one, change
 * the other.
 *
 * Hot is a simple time-decayed vote score, not a personalized ranking:
 *
 *   hot = vote_score / (hours_since_published + 2) ^ 1.5
 *
 * The +2 keeps brand-new posts from dividing by ~0, and the 1.5 exponent
 * makes a day-old post need roughly 10x the votes of a two-hour-old one to
 * sit beside it. The decay constant is a tuning knob (Deferred to
 * Implementation in the plan).
 */

export const HOT_GRAVITY = 1.5;
export const HOT_OFFSET_HOURS = 2;

export type FeedTab = "hot" | "new" | "my_team";

export const FEED_TABS: readonly FeedTab[] = ["hot", "new", "my_team"];

export function isFeedTab(value: unknown): value is FeedTab {
  return typeof value === "string" && (FEED_TABS as readonly string[]).includes(value);
}

export interface RankablePost {
  voteScore: number;
  /** ISO timestamp or Date of publication (created_at when unpublished). */
  publishedAt: string | Date;
  teamId?: number | null;
}

function toMillis(value: string | Date): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Hours between two instants, never negative (clock skew, future stamps). */
export function hoursSince(publishedAt: string | Date, now: Date = new Date()): number {
  const diff = now.getTime() - toMillis(publishedAt);
  return diff <= 0 ? 0 : diff / 3_600_000;
}

/** The time-decayed score used to order the Hot tab. */
export function hotScore(voteScore: number, publishedAt: string | Date, now: Date = new Date()): number {
  const hours = hoursSince(publishedAt, now);
  return voteScore / Math.pow(hours + HOT_OFFSET_HOURS, HOT_GRAVITY);
}

export interface RankOptions {
  now?: Date;
  /** Needed for the my_team tab; with none the tab is empty. */
  favoriteTeamId?: number | null;
}

/**
 * Orders (and for my_team, filters) posts the way the feed does. Ties fall
 * back to newest first so the order is stable.
 */
export function rankFeed<T extends RankablePost>(posts: readonly T[], tab: FeedTab, options: RankOptions = {}): T[] {
  const now = options.now ?? new Date();
  const byNewest = (a: T, b: T) => toMillis(b.publishedAt) - toMillis(a.publishedAt);

  if (tab === "my_team") {
    const team = options.favoriteTeamId;
    if (team === null || team === undefined) return [];
    return posts.filter((p) => p.teamId === team).sort(byNewest);
  }
  if (tab === "new") {
    return [...posts].sort(byNewest);
  }
  return [...posts].sort((a, b) => {
    const diff = hotScore(b.voteScore, b.publishedAt, now) - hotScore(a.voteScore, a.publishedAt, now);
    return diff !== 0 ? diff : byNewest(a, b);
  });
}
