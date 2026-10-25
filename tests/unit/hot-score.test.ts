import { describe, expect, it } from "vitest";

import { HOT_GRAVITY, HOT_OFFSET_HOURS, hotScore, hoursSince, isFeedTab, rankFeed } from "@shared/domain/hot-score.ts";

const NOW = new Date("2026-10-25T20:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("hotScore", () => {
  it("matches vote_score / (hours + 2) ^ 1.5", () => {
    expect(hotScore(10, hoursAgo(0), NOW)).toBeCloseTo(10 / Math.pow(HOT_OFFSET_HOURS, HOT_GRAVITY));
    expect(hotScore(10, hoursAgo(6), NOW)).toBeCloseTo(10 / Math.pow(8, 1.5));
  });

  it("decays with age: the same votes score lower on an older post", () => {
    expect(hotScore(5, hoursAgo(1), NOW)).toBeGreaterThan(hotScore(5, hoursAgo(10), NOW));
  });

  it("is zero with no votes whatever the age", () => {
    expect(hotScore(0, hoursAgo(0), NOW)).toBe(0);
    expect(hotScore(0, hoursAgo(100), NOW)).toBe(0);
  });

  it("treats a future or unparsable timestamp as age zero", () => {
    expect(hoursSince(hoursAgo(-3), NOW)).toBe(0);
    expect(hoursSince("not a date", NOW)).toBeGreaterThan(0);
    expect(Number.isFinite(hotScore(3, "not a date", NOW))).toBe(true);
  });
});

describe("rankFeed", () => {
  const posts = [
    { id: "old-popular", voteScore: 40, publishedAt: hoursAgo(48), teamId: 14 },
    { id: "fresh-few", voteScore: 3, publishedAt: hoursAgo(1), teamId: 19 },
    { id: "newest-none", voteScore: 0, publishedAt: hoursAgo(0.1), teamId: 14 },
    { id: "mid", voteScore: 12, publishedAt: hoursAgo(5), teamId: null },
  ];

  it("hot: a day-old post needs far more votes to beat a fresh one", () => {
    const ids = rankFeed(posts, "hot", { now: NOW }).map((p) => p.id);
    expect(ids[0]).toBe("mid");
    expect(ids.indexOf("fresh-few")).toBeLessThan(ids.indexOf("old-popular"));
    expect(ids.at(-1)).toBe("newest-none");
  });

  it("hot: ties fall back to newest first", () => {
    const tied = [
      { id: "a", voteScore: 0, publishedAt: hoursAgo(3) },
      { id: "b", voteScore: 0, publishedAt: hoursAgo(1) },
    ];
    expect(rankFeed(tied, "hot", { now: NOW }).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("new: newest first regardless of votes", () => {
    expect(rankFeed(posts, "new", { now: NOW }).map((p) => p.id)).toEqual(["newest-none", "fresh-few", "mid", "old-popular"]);
  });

  it("my_team: only the viewer's team, newest first; empty with no favorite", () => {
    expect(rankFeed(posts, "my_team", { now: NOW, favoriteTeamId: 14 }).map((p) => p.id)).toEqual(["newest-none", "old-popular"]);
    expect(rankFeed(posts, "my_team", { now: NOW, favoriteTeamId: null })).toEqual([]);
    expect(rankFeed(posts, "my_team", { now: NOW })).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...posts];
    rankFeed(posts, "hot", { now: NOW });
    expect(posts).toEqual(copy);
  });
});

describe("isFeedTab", () => {
  it("accepts the three tabs and nothing else", () => {
    expect(isFeedTab("hot")).toBe(true);
    expect(isFeedTab("new")).toBe(true);
    expect(isFeedTab("my_team")).toBe(true);
    expect(isFeedTab("top")).toBe(false);
    expect(isFeedTab(undefined)).toBe(false);
  });
});
