import { expect, test } from "@playwright/test";

test.describe("unified article workflow", () => {
  test("unlocks article generation after confirming an outline without planning images", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    let imagePlanRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/api\/articles\/[0-9a-f-]+\/image-plan$/.test(new URL(request.url()).pathname)
      ) {
        imagePlanRequests += 1;
      }
    });

    await page.goto("/articles/new");
    await page.getByLabel("知识点", { exact: true }).fill("什么是机会成本");
    // E2E 不覆盖真实联网搜集（零外网请求）：默认勾选会让提交卡在 research 阶段。
    await page.getByRole("checkbox", { name: "联网搜集资料" }).uncheck();
    await page.getByRole("button", { name: "创建文章" }).click();

    await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\?step=outline$/);
    const workflow = page.getByRole("navigation", { name: "文章工作流" });
    await expect(workflow.getByRole("button")).toHaveCount(4);
    await expect(workflow.getByRole("button", { name: /资料来源/ })).toBeEnabled();
    await expect(workflow.getByRole("button", { name: /文章大纲/ })).toHaveAttribute("aria-current", "step");
    await expect(workflow.getByRole("button", { name: /正文文章/ })).toBeDisabled();
    await expect(workflow.getByRole("button", { name: /配图/ })).toBeDisabled();

    await page.getByRole("button", { name: "生成理解与大纲" }).click();
    await page.getByRole("button", { name: "审核大纲" }).click();
    await expect(page.getByText("审核通过", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认大纲" }).click();
    await expect(page).toHaveURL(/\?step=article$/);
    await expect(workflow.getByRole("button", { name: /正文文章/ })).toHaveAttribute("aria-current", "step");
    const generateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/articles\/[0-9a-f-]+\/content\/generate$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "生成完整正文" }).click();
    await expect((await generateResponse).ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "用大白话讲清楚：什么是机会成本" })
    ).toBeVisible();

    await expect(workflow.getByRole("button", { name: /配图/ })).toBeEnabled();
    await expect(workflow.getByRole("button", { name: /配图/ })).toContainText("可进入");
    await workflow.getByRole("button", { name: /配图/ }).click();
    await expect(page).toHaveURL(/\?step=images$/);
    await expect(page.getByRole("region", { name: "配图规划" })).toBeVisible();
    await expect(page.getByRole("button", { name: "分析配图需求" })).toBeVisible();
    expect(imagePlanRequests).toBe(0);
  });
});
