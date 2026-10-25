import { expect, test } from "@playwright/test";

/**
 * Pick flow against a local Supabase stack (plan U5).
 *
 * Needs E2E_WITH_SUPABASE=1, a seeded open game for today, and a signed-in
 * session. Set E2E_USERNAME / E2E_PASSWORD for an existing account; the
 * login page signs in with a username only when recovery-based login is
 * used, so this spec logs in through the form.
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

test("picking a team saves it, shows the split and allows a change before lock", async ({ page }) => {
  await page.goto("/picks");
  const card = page.locator("section[aria-label^='Pick:']").first();
  await expect(card).toBeVisible();

  // Before picking: prompt copy and no split.
  await expect(card.getByText("Tap a team to make your pick. Locks at first pitch.")).toBeVisible();
  await expect(card.getByLabel("Fan split")).toHaveCount(0);

  const buttons = card.getByRole("group", { name: /Pick a winner/ }).getByRole("button");
  await expect(buttons).toHaveCount(2);
  const first = buttons.nth(0);
  const second = buttons.nth(1);

  // Buttons are at least 44 px tall (60 px by design).
  const box = await first.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByText(/You picked/)).toBeVisible();
  await expect(card.getByLabel("Fan split")).toBeVisible();

  // Copy never says "bet".
  await expect(card).not.toContainText(/\bbet\b/i);

  // Change the pick.
  await card.getByRole("button", { name: "Change" }).click();
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");

  // Survives a reload: the database holds the pick.
  await page.reload();
  const reloaded = page.locator("section[aria-label^='Pick:']").first();
  await expect(reloaded.getByRole("button", { pressed: true })).toHaveCount(1);
});

test("the picks page renders at phone width without horizontal scroll", async ({ page }) => {
  await page.goto("/picks");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
