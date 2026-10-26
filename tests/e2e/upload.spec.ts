import { expect, test } from "@playwright/test";

/**
 * Fan edit uploads against a local Supabase stack (plan U11).
 *
 * Needs E2E_WITH_SUPABASE=1 and a signed-in regular account (E2E_USERNAME /
 * E2E_PASSWORD). The happy path also needs a short fixture clip at
 * E2E_UPLOAD_CLIP (an MP4 of 60 seconds or less); without it only the
 * client-side rejection paths run.
 */
test.skip(!process.env.E2E_WITH_SUPABASE, "needs the local Supabase stack");

const USERNAME = process.env.E2E_USERNAME ?? "e2e_fan";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CLIP = process.env.E2E_UPLOAD_CLIP;

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(USERNAME);
  if (PASSWORD) await page.getByLabel(/password|recovery code/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test("the upload tab shows the rules and the uploader", async ({ page }) => {
  await page.goto("/post/new?tab=upload");
  await expect(page.getByRole("link", { name: /full upload rules/i })).toHaveAttribute("href", "/rules#uploads");
  await expect(page.getByTestId("upload-file")).toBeVisible();
  const submit = page.getByRole("button", { name: /upload for review/i });
  await expect(submit).toHaveCount(0);
});

test("an HTML file renamed to .mp4 is turned away before upload", async ({ page }) => {
  await page.goto("/post/new?tab=upload");
  await page.getByTestId("upload-file").setInputFiles({
    name: "notavideo.mp4",
    mimeType: "text/html",
    buffer: Buffer.from("<!doctype html><html></html>"),
  });
  await expect(page.getByTestId("upload-message")).toContainText(/MP4 or MOV/i);
});

test("a clip uploads and shows as pending review", async ({ page }) => {
  test.skip(!CLIP, "set E2E_UPLOAD_CLIP to a short MP4");
  await page.goto("/post/new?tab=upload");
  await page.getByTestId("upload-file").setInputFiles(CLIP!);
  await expect(page.getByTestId("upload-duration")).toBeVisible();
  await page.getByLabel(/^title/i).fill(`e2e edit ${Date.now()}`);
  await page.getByRole("button", { name: /upload for review/i }).click();
  await expect(page.getByTestId("upload-pending")).toContainText(/pending review/i, { timeout: 120_000 });

  await page.goto("/profile/uploads");
  const row = page.getByTestId("my-upload").first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/pending review|scanning/i);
});
