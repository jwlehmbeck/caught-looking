import { expect, test } from "@playwright/test";

test("a signed-out visitor is sent from home to signup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CAUGHT");
});

test("the signup page renders at phone width without horizontal scroll", async ({ page }) => {
  await page.goto("/signup");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
