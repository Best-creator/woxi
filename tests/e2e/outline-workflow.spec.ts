import { expect, test } from "@playwright/test";

test.describe("outline workflow", () => {
  test("generates, reviews, versions and confirms an outline", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    await page.goto("/articles/new");
    await page.getByLabel("知识点", { exact: true }).fill("什么是机会成本");
    // E2E 不覆盖真实联网搜集（零外网请求）：默认勾选会让提交卡在 research 阶段。
    await page.getByRole("checkbox", { name: "联网搜集资料" }).uncheck();
    await page.getByRole("button", { name: "创建文章" }).click();

    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\?step=outline$/);
    await page.getByRole("button", { name: "生成理解与大纲" }).click();
    await page.getByRole("button", { name: "审核大纲" }).click();
    await expect(page.getByText("审核通过", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "确认大纲" }).click();
    await expect(page).toHaveURL(/\?step=article$/);
    // 第 3 步内嵌正文工作台：确认大纲后就地生成正文，不再跳独立页面。
    await expect(page.getByRole("region", { name: "正文工作台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成完整正文" })).toBeVisible();
  });

  test("keeps the generated outline workspace within the mobile viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");

    await page.goto("/articles/new");
    await page.getByLabel("知识点", { exact: true }).fill("什么是机会成本");
    // E2E 不覆盖真实联网搜集（零外网请求）：默认勾选会让提交卡在 research 阶段。
    await page.getByRole("checkbox", { name: "联网搜集资料" }).uncheck();
    await page.getByRole("button", { name: "创建文章" }).click();
    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\?step=outline$/);

    await page.getByRole("button", { name: "生成理解与大纲" }).click();
    await expect(page.getByRole("button", { name: "审核大纲" })).toBeEnabled();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
});
