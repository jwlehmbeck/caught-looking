import { expect, test } from "@playwright/test";

// Public pages: no database or sign-in needed, so these are not gated.
const PAGES = [
  { path: "/rules", heading: "House rules" },
  { path: "/terms", heading: "Terms of use" },
  { path: "/privacy", heading: "Privacy notice" },
  { path: "/child-safety", heading: "Child safety standards" },
  { path: "/contact", heading: "Contact us" },
];

for (const { path, heading } of PAGES) {
  test(`${path} loads signed out at phone width`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByText("Last updated")).toBeVisible();
    await expect(page.getByRole("link", { name: /back to caught looking/i })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Policies" });
    for (const label of ["Rules", "Terms", "Privacy", "Child safety", "Contact"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}

test("/rules keeps the #uploads section", async ({ page }) => {
  await page.goto("/rules#uploads");
  await expect(page.locator("#uploads")).toBeVisible();
  await expect(page.locator("#uploads").getByRole("heading", { level: 2 })).toHaveText("Fan edit uploads");
});

test("terms and privacy show the draft notice", async ({ page }) => {
  for (const path of ["/terms", "/privacy"]) {
    await page.goto(path);
    await expect(page.getByText(/Draft — pending legal review/)).toBeVisible();
  }
});

test("child safety page names the contact and crisis lines", async ({ page }) => {
  await page.goto("/child-safety");
  await expect(page.getByText("Jason Lehmbeck")).toBeVisible();
  await expect(page.getByText(/CyberTipline/).first()).toBeVisible();
  await expect(page.getByText("741741")).toBeVisible();
});
