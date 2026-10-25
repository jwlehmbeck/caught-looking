import { expect, test } from "@playwright/test";

/**
 * Game page against a local Supabase stack (plan U8).
 *
 * Needs E2E_WITH_SUPABASE=1, a signed-in account and seeded games whose ids
 * are passed in:
 *   E2E_GAME_FINAL      a scored game the account picked (correct or wrong)
 *   E2E_GAME_POSTPONED  a void game with detailed_state "Postponed"
 *   E2E_GAME_SUSPENDED  a suspended game
 *   E2E_GAME_OPEN       an open game the account has not picked yet
 * A scenario is skipped when its game id is missing.
 */
test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack and seeded games");

const USERNAME = process.env.E2E_USERNAME ?? "e2e_fan";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(USERNAME);
  if (PASSWORD) await page.getByLabel(/password|recovery code/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test("after a final the user sees their result, new hit rate and highlight links", async ({ page }) => {
  const id = process.env.E2E_GAME_FINAL;
  test.skip(!id, "set E2E_GAME_FINAL");
  await page.goto(`/game/${id}`);

  const result = page.getByRole("region", { name: "Your result" });
  await expect(result).toBeVisible();
  await expect(result.getByRole("heading", { level: 2 })).toHaveText(/You called it|Caught looking|You didn't pick this one/i);
  await expect(result).toContainText(/Hit rate now \d+% \(\d+ of \d+\)|picks to unlock/);

  const links = page.getByRole("link", { name: /Opens on MLB\.com/ });
  await expect(links.first()).toBeVisible();
  await expect(links.first()).toHaveAttribute("href", /^https:\/\/(www\.)?mlb\.com\//);
  await expect(links.first()).toHaveAttribute("target", "_blank");
  await expect(links.first()).toHaveAttribute("rel", /noopener/);
  const box = await links.first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await expect(page.getByText("Not affiliated with MLB or any club.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\bbet\b/i);
});

test("a postponed game shows the void message and no result card", async ({ page }) => {
  const id = process.env.E2E_GAME_POSTPONED;
  test.skip(!id, "set E2E_GAME_POSTPONED");
  await page.goto(`/game/${id}`);

  await expect(page.getByText("Postponed — picks reopen when it's rescheduled.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your result" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Pick a winner/ })).toHaveCount(0);
});

test("a suspended game shows 'Suspended, pick pending'", async ({ page }) => {
  const id = process.env.E2E_GAME_SUSPENDED;
  test.skip(!id, "set E2E_GAME_SUSPENDED");
  await page.goto(`/game/${id}`);

  await expect(page.getByText(/^Suspended, pick pending/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Your result" })).toHaveCount(0);
});

test("before lock the split and top predictors appear only after picking", async ({ page }) => {
  const id = process.env.E2E_GAME_OPEN;
  test.skip(!id, "set E2E_GAME_OPEN");
  await page.goto(`/game/${id}`);

  await expect(page.getByText(/Locks in/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the top predictors picked" })).toHaveCount(0);

  const card = page.locator("section[aria-label^='Pick:']").first();
  await card.getByRole("group", { name: /Pick a winner/ }).getByRole("button").first().click();
  await expect(card.getByLabel("Fan split")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "What the top predictors picked" })).toBeVisible();
});

test("an unknown game id is a 404", async ({ page }) => {
  const response = await page.goto("/game/999999999");
  expect(response?.status()).toBe(404);
});

test("the page renders at phone width without horizontal scroll", async ({ page }) => {
  const id = process.env.E2E_GAME_FINAL ?? process.env.E2E_GAME_OPEN;
  test.skip(!id, "set E2E_GAME_FINAL or E2E_GAME_OPEN");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/game/${id}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
