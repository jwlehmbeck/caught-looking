import { expect, test } from "@playwright/test";

/**
 * The home screen (plan U7) against a local Supabase stack.
 *
 * Needs E2E_WITH_SUPABASE=1 and a signed-in regular account
 * (E2E_USERNAME / E2E_PASSWORD). Works with or without games today: the
 * strip and pick card only appear when there are games.
 */
test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack");

const USERNAME = process.env.E2E_USERNAME ?? "e2e_fan";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(USERNAME);
  if (PASSWORD) await page.getByLabel(/password|recovery code/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test("home renders at 390 px with the header, feed and bottom nav, and no sideways scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CAUGHT LOOKING");
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Feed" })).toBeVisible();
  await expect(page.getByText("Not affiliated with MLB or any club.")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(nav.getByRole("link", { name: "Feed" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "New post" })).toHaveAttribute("href", "/post/new");
  for (const link of await nav.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("either today's games or the no-games line shows", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByRole("list", { name: "Today's games" });
  const none = page.getByText("No games today");
  await expect(strip.or(none).first()).toBeVisible();
  if (await strip.isVisible()) {
    await expect(
      page.getByRole("heading", { name: /make your pick|all picked|picks are locked/i }).first(),
    ).toBeVisible();
  }
});

test("My Team tab keeps the tab and shows posts or the league-wide fallback", async ({ page }) => {
  await page.goto("/?tab=my_team");
  await expect(page.getByRole("link", { name: "My Team" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("list", { name: "Posts" }).or(page.getByText(/nothing|pick a favorite team/i)).first()).toBeVisible();
});

test("/feed redirects to home and other main pages get the bottom nav", async ({ page }) => {
  await page.goto("/feed?tab=new");
  await expect(page).toHaveURL(/\/\?tab=new$/);
  await page.goto("/leaderboard");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ranks" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
