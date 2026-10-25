import { expect, test } from "@playwright/test";

/**
 * Live chat against a local Supabase stack (plan U9).
 *
 * Needs E2E_WITH_SUPABASE=1, a signed-in account at least 24 hours old and
 * seeded games whose ids are passed in:
 *   E2E_GAME_LIVE   a live (or locked) game
 *   E2E_GAME_OPEN   an open game whose lock time is in the future
 *   E2E_GAME_FINAL  a game whose final was more than 30 minutes ago
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

test("a message sent in a live game shows up in the room", async ({ page }) => {
  const id = process.env.E2E_GAME_LIVE;
  test.skip(!id, "set E2E_GAME_LIVE");
  await page.goto(`/game/${id}`);

  const chat = page.getByRole("region", { name: /live chat/i });
  await expect(chat).toBeVisible();
  const input = chat.getByLabel(/message/i);
  const text = `go team ${Date.now()}`;
  await input.fill(text);
  await input.press("Enter");

  await expect(chat.getByRole("list", { name: "Messages" })).toContainText(text);
  await expect(chat.getByRole("button", { name: /wait \d+s/i })).toBeVisible();
  await expect(chat.getByRole("button", { name: /report/i }).first()).toBeVisible();
});

test("a message with contact info is turned away with a neutral notice", async ({ page }) => {
  const id = process.env.E2E_GAME_LIVE;
  test.skip(!id, "set E2E_GAME_LIVE");
  await page.goto(`/game/${id}`);

  const chat = page.getByRole("region", { name: /live chat/i });
  const input = chat.getByLabel(/message/i);
  await input.fill("add me on snap: coolkid_2012");
  await input.press("Enter");
  await expect(chat.getByRole("alert")).toContainText(/can't be posted/i);
});

test("the room does not open before first pitch", async ({ page }) => {
  const id = process.env.E2E_GAME_OPEN;
  test.skip(!id, "set E2E_GAME_OPEN");
  await page.goto(`/game/${id}`);
  // Chat is not part of the pre-lock page; neither the room nor its input exists.
  await expect(page.getByRole("region", { name: /live chat/i })).toHaveCount(0);
  await expect(page.getByLabel(/^message/i)).toHaveCount(0);
});

test("31 minutes after the final the room is read-only", async ({ page }) => {
  const id = process.env.E2E_GAME_FINAL;
  test.skip(!id, "set E2E_GAME_FINAL");
  await page.goto(`/game/${id}`);
  const chat = page.getByRole("region", { name: /live chat/i });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("status")).toContainText(/chat closed/i);
  await expect(chat.getByLabel(/^message/i)).toHaveCount(0);
});
