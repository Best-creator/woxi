// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { SqliteSourceWorkflow } from "@/features/sources/sqlite-workflow";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../tests/helpers/request";
import { createSourceRouteHandlers } from "./route";
import { createSourceItemRouteHandlers } from "./[sourceId]/route";

describe("article sources routes", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const sourceContext = (id: string, sourceId: string) => ({
    params: Promise.resolve({ id, sourceId })
  });
  let articles: SqliteArticleRepository;
  let sources: SqliteSourceRepository;
  let workflow: SqliteSourceWorkflow;
  let handlers: ReturnType<typeof createSourceRouteHandlers>;
  let itemHandlers: ReturnType<typeof createSourceItemRouteHandlers>;

  beforeEach(() => {
    const db = createTestDatabase();
    articles = new SqliteArticleRepository(db);
    sources = new SqliteSourceRepository(db);
    workflow = new SqliteSourceWorkflow(db);
    handlers = createSourceRouteHandlers(articles, sources, workflow);
    itemHandlers = createSourceItemRouteHandlers(articles, sources, workflow);
  });

  it("rejects blank source metadata", async () => {
    const article = await articles.create({ topic: "复利" });
    const response = await handlers.POST(
      requestJson(`http://test/api/articles/${article.id}/sources`, {
        title: " ",
        type: "text",
        content: " ", expectedUpdatedAt: article.updatedAt
      }),
      context(article.id)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请输入资料标题和内容" });
  });

  it("creates and lists an unsupported source without using it for generation", async () => {
    const article = await articles.create({ topic: "复利" });
    const createResponse = await handlers.POST(
      requestJson(`http://test/api/articles/${article.id}/sources`, {
        title: "研究报告",
        type: "pdf",
        content: "等待解析", expectedUpdatedAt: article.updatedAt
      }),
      context(article.id)
    );
    const created = (await createResponse.json()).source;

    expect(createResponse.status).toBe(201);
    expect(created.status).toBe("unsupported");

    const listResponse = await handlers.GET(
      new Request(`http://test/api/articles/${article.id}/sources`),
      context(article.id)
    );
    expect((await listResponse.json()).sources).toHaveLength(1);
  });

  it("toggles and deletes only a source belonging to the article", async () => {
    const firstArticle = await articles.create({ topic: "复利" });
    const secondArticle = await articles.create({ topic: "机会成本" });
    const source = await sources.create({
      articleId: firstArticle.id,
      title: "课堂笔记",
      type: "text",
      content: "时间会放大积累。"
    });

    const forbiddenToggle = await itemHandlers.PATCH(
      requestJson("http://test/api/articles/second/sources/source", { enabled: false, expectedUpdatedAt: secondArticle.updatedAt }, "PATCH"),
      sourceContext(secondArticle.id, source.id)
    );
    expect(forbiddenToggle.status).toBe(404);

    const toggle = await itemHandlers.PATCH(
      requestJson(`http://test/api/articles/${firstArticle.id}/sources/${source.id}`, { enabled: false, expectedUpdatedAt: firstArticle.updatedAt }, "PATCH"),
      sourceContext(firstArticle.id, source.id)
    );
    expect((await toggle.json()).source.enabled).toBe(false);

    const remove = await itemHandlers.DELETE(
      new Request(`http://test/api/articles/${firstArticle.id}/sources/${source.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: (await articles.findById(firstArticle.id))!.updatedAt })
      }),
      sourceContext(firstArticle.id, source.id)
    );
    expect(remove.status).toBe(200);
    expect(await sources.findById(firstArticle.id, source.id)).toBeNull();
  });
});
