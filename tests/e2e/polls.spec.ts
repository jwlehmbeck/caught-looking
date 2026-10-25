import { expect, test } from "@playwright/test";

/**
 * Rivalry polls against a local Supabase stack (plan U13).
 *
 * Needs E2E_WITH_SUPABASE=1, a signed-in regular account (E2E_USERNAME /
 * E2E_PASSWORD) and at least one open poll the account has not voted in.
 */
test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack and a seeded poll");

const USERNAME = process.env.E2E_USERNAME ?? "e2e_fan";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(USERNAME);
  if (PASSWORD) await page.getByLabel(/password|recovery code/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test("a user votes once and then sees results", async ({ page }) => {
  await page.goto("/polls");
  const card = page.getByTestId("poll-card").filter({ hasText: "Vote to see results" }).first();
  await expect(card).toBeVisible();

  const options = card.getByRole("group").getByRole("button");
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(4);
  const box = await options.first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await options.first().click();

  const results = card.getByRole("list", { name: "Results" });
  await expect(results).toBeVisible();
  await expect(card).toContainText(/your pick/);
  await expect(card).toContainText(/\d+ votes?/);
  await expect(card.getByRole("group")).toHaveCount(0);
});

test("a regular user has no New poll link and cannot open the form", async ({ page }) => {
  await page.goto("/polls");
  await expect(page.getByRole("link", { name: "New poll" })).toHaveCount(0);
  await page.goto("/polls/new");
  await expect(page).toHaveURL(/\/polls$/);
});
