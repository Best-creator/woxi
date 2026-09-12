import { expect, test } from "@playwright/test";

test("opens an empty page", async ({ page }) => {
  await page.goto("about:blank");
  expect(await page.title()).toBe("");
});

