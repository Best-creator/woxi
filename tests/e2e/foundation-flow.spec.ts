import { expect, test } from "@playwright/test";

test.describe("foundation content workflow", () => {
  test("creates an article, collects sources and confirms an outline", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    await page.goto("/");
    await page.getByRole("link", { name: "新建文章" }).click();
    await page.getByRole("textbox", { name: "知识点", exact: true }).fill("什么是机会成本");
    await page.getByRole("button", { name: "创建文章" }).click();

    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\?step=outline$/);
    await page.getByRole("button", { name: "添加资料" }).click();
    await page.getByLabel("资料标题").fill("决策课笔记");
    await page.getByLabel("资料内容").fill("机会成本，是选择一个方案时放弃的最佳替代方案。");
    await page.getByRole("button", { name: "保存资料" }).click();
    await expect(page.getByText("决策课笔记")).toBeVisible();

    await page.getByRole("button", { name: "生成理解与大纲" }).click();
    await page.getByRole("button", { name: "审核大纲" }).click();
    await expect(page.getByText("审核通过", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认大纲" }).click();

    // 确认大纲后落到第 3 步正文工作台；正文、配图与预览的断言在 content-workflow.spec.ts。
    await expect(page).toHaveURL(/\?step=article$/);
    await expect(page.getByRole("region", { name: "正文工作台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成完整正文" })).toBeVisible();
  });

  test("keeps the mobile list within the viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "内容工作台" })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
