import { expect, test, type Page } from "@playwright/test";

interface SetupOptions {
  topic: string;
  source?: { title: string; content: string };
}

/**
 * 走完资料 → 大纲 → 审核 → 确认，把文章推进到第 3 步（正文）。
 * 返回工作台所在的 URL，便于断言文章 id。
 */
async function setupArticle(page: Page, { topic, source }: SetupOptions) {
  await page.goto("/articles/new");
  await page.getByLabel("知识点", { exact: true }).fill(topic);
  // E2E 不覆盖真实联网搜集（零外网请求）：默认勾选会让提交卡在 research 阶段。
  await page.getByRole("checkbox", { name: "联网搜集资料" }).uncheck();
  await page.getByRole("button", { name: "创建文章" }).click();

  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+\?step=outline$/);

  if (source) {
    await page.getByRole("button", { name: "添加资料" }).click();
    await page.getByLabel("资料标题").fill(source.title);
    await page.getByLabel("资料内容").fill(source.content);
    await page.getByRole("button", { name: "保存资料" }).click();
    await expect(page.getByText(source.title)).toBeVisible();
  }

  await page.getByRole("button", { name: "生成理解与大纲" }).click();
  await page.getByRole("button", { name: "审核大纲" }).click();
  await expect(page.getByText("审核通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认大纲" }).click();
  await expect(page).toHaveURL(/\?step=article$/);
  await expect(page.getByRole("region", { name: "正文工作台" })).toBeVisible();
}

function articleIdFrom(page: Page) {
  const match = /\/articles\/([0-9a-f-]+)/.exec(page.url());
  if (!match) throw new Error(`URL 中缺少文章 id：${page.url()}`);
  return match[1];
}

/** 记录的数组应为空：工作台已经不再请求阶段 1 的旧生成端点（现在固定返回 410）。 */
function collectLegacyGenerateRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (
      request.method() === "POST" &&
      /^\/api\/articles\/[0-9a-f-]+\/generate$/.test(pathname)
    ) {
      requests.push(pathname);
    }
  });
  return requests;
}

test.describe("content workflow", () => {
  test("generates, reviews and approves the body inside step three", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    await setupArticle(page, { topic: "什么是机会成本" });
    const articleId = articleIdFrom(page);
    const workflow = page.getByRole("navigation", { name: "文章工作流" });
    const legacyGenerateRequests = collectLegacyGenerateRequests(page);

    // 人物语言风格是正文生成的输入之一。
    await page.getByLabel("人物语言风格").selectOption("knowledge_cards");
    await expect(page.locator("#style-preset")).toHaveValue("knowledge_cards");

    const generateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/content\/generate$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "生成完整正文" }).click();
    await expect((await generateResponse).ok()).toBe(true);

    await expect(
      page.getByRole("heading", { name: "用大白话讲清楚：什么是机会成本" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "查看正文 v1" })).toBeVisible();
    // 审核为可选步骤：未审核时确认按钮可用，文案为「直接确认（未审核）」。
    await expect(page.getByRole("button", { name: "直接确认（未审核）" })).toBeEnabled();

    const reviewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/content\/review$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "审核正文" }).click();
    await expect((await reviewResponse).ok()).toBe(true);
    await expect(page.getByText("审核通过", { exact: true })).toBeVisible();

    const approveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/content\/approve$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "确认内容" }).click();
    await expect((await approveResponse).ok()).toBe(true);
    // 确认成功后工作台自动进入配图步骤（ec590f5 起的动线）。
    await expect(page.getByRole("heading", { name: "规划配图" })).toBeVisible();

    // 确认内容后配图步骤解锁，且正文状态落库为 content_ready。
    await expect(workflow.getByRole("button", { name: /配图/ })).toBeEnabled();
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/articles/${articleId}`);
        const body = (await response.json()) as { article: { status: string } };
        return body.article.status;
      })
      .toBe("content_ready");
    expect(legacyGenerateRequests).toEqual([]);
  });

  test("saves a manual version and restores it as a new one", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    await setupArticle(page, { topic: "为什么复利需要时间" });
    await page.getByRole("button", { name: "生成完整正文" }).click();
    await expect(page.getByRole("button", { name: "查看正文 v1" })).toBeVisible();

    await page.getByLabel("正文块 1").fill("机会成本是放弃的最佳替代方案。");
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/content\/versions$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "保存当前版本" }).click();
    await expect((await saveResponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "查看正文 v2" })).toBeVisible();

    // 预览旧版本时编辑器只读；恢复会生成新版本，而不是移动历史。
    await page.getByRole("button", { name: "查看正文 v1" }).click();
    await expect(page.getByText("正在查看正文 v1")).toBeVisible();
    await expect(page.getByLabel("正文块 1")).toHaveAttribute("readonly", "");

    const restoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/content\/versions\/[0-9a-f-]+\/restore$/.test(new URL(response.url()).pathname)
    );
    await page.getByRole("button", { name: "恢复为当前" }).click();
    await expect((await restoreResponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "查看正文 v3" })).toBeVisible();
  });

  test("plans images, previews and copies the finished article", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    await setupArticle(page, {
      topic: "什么是机会成本",
      source: {
        title: "决策课笔记",
        content: "机会成本，是选择一个方案时放弃的最佳替代方案。"
      }
    });
    await page.getByRole("button", { name: "生成完整正文" }).click();
    await expect(
      page.getByRole("heading", { name: "用大白话讲清楚：什么是机会成本" })
    ).toBeVisible();

    // 配图规划要求正文已基于当前确认大纲，因此先让正文编辑落盘。
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /\/api\/articles\/[0-9a-f-]+$/.test(new URL(response.url()).pathname)
    );
    await page.getByLabel("正文块 1").fill("机会成本，是选择一种方案时放弃的最佳替代方案。");
    await saveResponse;
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();

    await page
      .getByRole("navigation", { name: "文章工作流" })
      .getByRole("button", { name: /配图/ })
      .click();
    await page.getByRole("button", { name: "根据正文设计动漫分镜" }).click();
    await expect(page.getByText("待生成").first()).toBeVisible();
    await expect(page.locator("img.image-plan-thumbnail").first()).toBeVisible();

    const imageSaveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /\/api\/articles\/[0-9a-f-]+\/image-assets\/[0-9a-f-]+$/.test(new URL(response.url()).pathname)
    );
    await page.getByLabel("配图提示词 1").fill("清晰解释机会成本的对比信息图");
    await page.getByLabel("配图提示词 1").press("Tab");
    await imageSaveResponse;
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "预览" }).click();
    await expect(page.getByRole("dialog", { name: "公众号预览" })).toBeVisible();
    const preview = page.frameLocator("iframe[title='公众号文章预览']");
    await expect(preview.getByText("机会成本，是选择一种方案时放弃的最佳替代方案。")).toBeVisible();
    const previewImage = preview.locator("img[src*='/api/image-assets/']").first();
    await expect(previewImage).toBeVisible();
    await expect
      .poll(async () => previewImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "复制到公众号" }).click();
    await expect(page.getByText("已复制富文本")).toBeVisible();
  });

  test("keeps the content workspace read-only and within the mobile viewport", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");

    // 移动端第 3 步是只读查看，因此用接口把文章推进到有正文的状态。
    const createResponse = await request.post("/api/articles", {
      data: { topic: "什么是机会成本" }
    });
    const { article } = await createResponse.json();
    const sourceResponse = await request.post(`/api/articles/${article.id}/sources`, {
      data: {
        title: "课堂笔记",
        type: "markdown",
        content: "机会成本，是选择一个方案时放弃的最佳替代方案。",
        expectedUpdatedAt: article.updatedAt
      }
    });
    const { article: sourcedArticle } = await sourceResponse.json();
    const outlineResponse = await request.post(`/api/articles/${article.id}/outline/generate`, {
      data: { expectedUpdatedAt: sourcedArticle.updatedAt, lengthPreset: "standard" }
    });
    const { article: outlineArticle } = await outlineResponse.json();
    await request.post(`/api/articles/${article.id}/outline/review`, {
      data: { expectedUpdatedAt: outlineArticle.updatedAt }
    });
    const confirmedResponse = await request.post(`/api/articles/${article.id}/outline/confirm`, {
      data: { expectedUpdatedAt: outlineArticle.updatedAt, acknowledgeWarnings: true }
    });
    const { article: confirmedArticle } = await confirmedResponse.json();
    await request.post(`/api/articles/${article.id}/content/generate`, {
      data: { expectedUpdatedAt: confirmedArticle.updatedAt, styleProfile: { preset: "popular_science_teacher" } }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/articles/${article.id}?step=article`);
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.getByRole("region", { name: "正文工作台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "查看正文 v1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成完整正文" })).toBeDisabled();

    const blocks = page.locator(".block-input");
    await expect(blocks.first()).toBeVisible();
    expect(
      await blocks.evaluateAll((elements) =>
        elements.every((element) => (element as HTMLTextAreaElement).readOnly)
      )
    ).toBe(true);
    expect(
      await blocks.evaluateAll((elements) =>
        elements.every((element) => element.scrollHeight <= element.clientHeight + 1)
      )
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
});
