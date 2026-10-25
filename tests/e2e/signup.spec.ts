import { expect, test } from "@playwright/test";

const YEAR = new Date().getFullYear();

test.describe("age screen", () => {
  test("asks for month and year with no hint of a cutoff", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("When were you born");
    const year = page.getByLabel("Birth year");
    await expect(year.locator("option", { hasText: "1900" })).toHaveCount(1);
    await expect(year.locator("option", { hasText: String(YEAR) })).toHaveCount(1);
    // The copy never mentions the cutoff; only the year list contains "13"s.
    const copy = await page.locator("main").evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("select").forEach((s) => s.remove());
      return clone.textContent ?? "";
    });
    expect(copy).not.toMatch(/13|years old|age/i);
  });

  test("an under-13 answer shows the neutral screen and stays blocked on back", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Birth month").selectOption("1");
    await page.getByLabel("Birth year").selectOption(String(YEAR - 12));
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Thanks for your interest");
    await expect(page.getByText("You can't create an account right now.")).toBeVisible();
    await expect(page.getByText(/age|years old|13/i)).toHaveCount(0);

    // Going back and trying another year does not help on this device.
    await page.goBack();
    await page.goto("/signup?step=age");
    await expect(page.getByText("You can't create an account right now.")).toBeVisible();
    await expect(page.getByLabel("Birth year")).toHaveCount(0);

    // Nothing about the answer was stored in the browser.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain(String(YEAR - 12));
  });

  test("a 15-year-old moves on to the next step", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Birth month").selectOption("6");
    await page.getByLabel("Birth year").selectOption(String(YEAR - 15));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=(invite|rules)/);
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText("When were you born");
  });

  test("steps cannot be skipped by editing the URL", async ({ page }) => {
    await page.goto("/signup?step=password");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("When were you born");
  });
});

test.describe("full signup", () => {
  test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack and an invite code in E2E_INVITE_CODE");

  test("a 15-year-old lands on Home with a recovery code shown once", async ({ page }) => {
    const username = `e2e_${Date.now().toString(36)}`.slice(0, 20);
    await page.goto("/signup");
    await page.getByLabel("Birth month").selectOption("6");
    await page.getByLabel("Birth year").selectOption(String(YEAR - 15));
    await page.getByRole("button", { name: "Continue" }).click();

    if (/step=invite/.test(page.url())) {
      await page.getByLabel("Invite code").fill(process.env.E2E_INVITE_CODE ?? "");
      await page.getByRole("button", { name: "Continue" }).click();
    }

    await expect(page).toHaveURL(/step=rules/);
    await page.getByLabel(/I've read the house rules/).check();
    await page.getByRole("button", { name: "I agree" }).click();

    await expect(page).toHaveURL(/step=username/);
    await page.getByLabel("Username").fill(username);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=team/);
    await page.getByLabel(/LAD/).check();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=password/);
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByLabel("Type it again").fill("correct horse battery");
    await page.getByRole("button", { name: "Create account" }).click();

    const code = await page.getByLabel("Your recovery code").textContent();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    await page.getByLabel("Type the last 4 characters to continue").fill(code!.slice(-4));
    await page.getByRole("button", { name: "Let's go" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
