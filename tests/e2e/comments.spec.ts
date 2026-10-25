import { expect, test } from "@playwright/test";

/**
 * Feed posts and comments against a local Supabase stack (plan U10).
 *
 * Needs E2E_WITH_SUPABASE=1, a signed-in account and:
 *   E2E_POST_ID   a live post (an ingested MLB clip or a shared link)
 */
test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack and a seeded post");

const USERNAME = process.env.E2E_USERNAME ?? "e2e_fan";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(USERNAME);
  if (PASSWORD) await page.getByLabel(/password|recovery code/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test("the feed shows cards that link out and page with Load more, never autoplay", async ({ page }) => {
  await page.goto("/feed?tab=new");
  await expect(page.getByRole("navigation", { name: "Feed" }).getByRole("link", { name: "New" })).toHaveAttribute("aria-current", "page");

  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible();
  await expect(page.locator("video[autoplay], iframe")).toHaveCount(0);

  const out = cards.first().getByRole("link", { name: /Opens on (MLB\.com|YouTube)/ });
  await expect(out).toHaveAttribute("target", "_blank");
  await expect(out).toHaveAttribute("rel", /noopener/);

  const more = page.getByRole("button", { name: "Load more" });
  if (await more.isVisible()) {
    const before = await cards.count();
    await more.click();
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(before);
  }
  await expect(page.locator("main")).not.toContainText(/\bbet\b/i);
});

test("voting twice toggles the vote off", async ({ page }) => {
  const id = process.env.E2E_POST_ID;
  test.skip(!id, "set E2E_POST_ID");
  await page.goto(`/post/${id}`);

  const vote = page.getByRole("button", { name: /Vote up|Remove your vote/ });
  const pressed = (await vote.getAttribute("aria-pressed")) === "true";
  const start = Number((await vote.textContent())?.match(/\d+/)?.[0] ?? "0");

  await vote.click();
  await expect(vote).toHaveAttribute("aria-pressed", String(!pressed));
  await expect(vote).toContainText(String(start + (pressed ? -1 : 1)));

  await vote.click();
  await expect(vote).toHaveAttribute("aria-pressed", String(pressed));
  await expect(vote).toContainText(String(start));
});

test("a comment posts, a reply nests one level, and the counter tracks 500", async ({ page }) => {
  const id = process.env.E2E_POST_ID;
  test.skip(!id, "set E2E_POST_ID");
  await page.goto(`/post/${id}#comments`);

  const stamp = `that changeup was filthy ${Date.now()}`;
  const box = page.getByLabel("Add a comment");
  await box.fill(stamp);
  await expect(page.getByText(`${stamp.length}/500`)).toBeVisible();
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText(stamp)).toBeVisible();

  const item = page.getByRole("listitem").filter({ hasText: stamp }).first();
  await item.getByRole("button", { name: "Reply" }).click();
  const replyText = `agreed ${Date.now()}`;
  await item.getByLabel(/Reply to/).fill(replyText);
  await item.getByRole("button", { name: "Post" }).click();
  const reply = item.getByRole("list", { name: /Replies to/ }).getByText(replyText);
  await expect(reply).toBeVisible();
  // Replies cannot be replied to.
  await expect(item.getByRole("list", { name: /Replies to/ }).getByRole("button", { name: "Reply" })).toHaveCount(0);

  const box2 = page.getByLabel("Add a comment");
  await box2.fill("x".repeat(501));
  await expect(page.getByText("501/500")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post" }).first()).toBeDisabled();
});

test("a comment with contact info is turned away with a neutral message", async ({ page }) => {
  const id = process.env.E2E_POST_ID;
  test.skip(!id, "set E2E_POST_ID");
  await page.goto(`/post/${id}#comments`);
  await page.getByLabel("Add a comment").fill("add me on snap: jake_22");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("status")).toContainText(/can't be posted/i);
  await expect(page.getByText("add me on snap: jake_22")).toHaveCount(0);
});

test("sharing a link to another site is rejected", async ({ page }) => {
  await page.goto("/post/new");
  await page.getByLabel("Title").fill("Not a baseball site");
  await page.getByLabel("Link").fill("https://mlb.com.evil.example/video/x");
  await page.getByRole("button", { name: /Share to the feed/ }).click();
  await expect(page.getByRole("alert")).toContainText(/MLB\.com or a YouTube video/);
});
