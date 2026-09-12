// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepository } from "../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../tests/helpers/request";
import { createArticleRouteHandlers } from "./route";

describe("single article route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  let repository: ReturnType<typeof createTestRepository>;
  let handlers: ReturnType<typeof createArticleRouteHandlers>;

  beforeEach(() => {
    repository = createTestRepository();
    handlers = createArticleRouteHandlers(repository);
  });

  it("returns 404 for a missing article", async () => {
    const response = await handlers.GET(
      new Request("http://test/api/articles/missing"),
      context("missing")
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "文章不存在" });
  });

  it("updates an article with the expected version", async () => {
    const article = await repository.create({ topic: "复利" });
    const response = await handlers.PATCH(
      requestJson(
        `http://test/api/articles/${article.id}`,
        { ...article, title: "复利为什么有效", expectedUpdatedAt: article.updatedAt },
        "PATCH"
      ),
      context(article.id)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).article.title).toBe("复利为什么有效");
  });

  it("returns 409 for a stale update", async () => {
    const article = await repository.create({ topic: "复利" });
    const first = await repository.save(
      { ...article, title: "新标题" },
      article.updatedAt
    );
    expect(first.kind).toBe("saved");

    const response = await handlers.PATCH(
      requestJson(
        `http://test/api/articles/${article.id}`,
        { ...article, title: "过期标题", expectedUpdatedAt: article.updatedAt },
        "PATCH"
      ),
      context(article.id)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "文章已在其他位置更新，请刷新后重试"
    });
  });
});
