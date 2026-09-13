import { describe, expect, it, vi } from "vitest";
import { createResearchRouteHandler } from "./route";
import type { CollectWebResearchDependencies } from "@/features/research/collect-web-research";
import type { Article } from "@/features/articles/domain";
import type { SourceDocument } from "@/features/sources/domain";

// route.ts 顶层 import 了 @/server/services（含 node:sqlite），jsdom 无法打包。
// 这里只测 handler 工厂，mock 掉真实 services。
vi.mock("@/server/services", () => ({
  getArticleRepository: vi.fn(),
  getLlmJsonClient: vi.fn(() => null),
  getResearchDefaultModel: vi.fn(() => "demo-research"),
  getSourceWorkflow: vi.fn(),
  getWebSearch: vi.fn()
}));

const article = {
  id: "article-1",
  title: "t",
  topic: "t",
  status: "draft",
  brief: null,
  outline: [],
  blocks: [],
  planning: {},
  styleProfile: null,
  outlineConfirmedAt: null,
  createdAt: "2026-09-13T00:00:00.000Z",
  updatedAt: "2026-09-13T00:00:00.000Z"
} as unknown as Article;

const source: SourceDocument = {
  id: "source-1",
  articleId: "article-1",
  title: "AI 联网资料：t",
  type: "web",
  content: "# 资料",
  status: "ready",
  enabled: true,
  createdAt: "2026-09-13T00:01:00.000Z",
  updatedAt: "2026-09-13T00:01:00.000Z"
};

function dependenciesWith(overrides: {
  article?: Article | null;
  search?: () => Promise<unknown>;
  create?: () => Promise<unknown>;
} = {}): CollectWebResearchDependencies {
  return {
    articles: { findById: vi.fn(async () => overrides.article === undefined ? article : overrides.article) },
    workflow: {
      create: (overrides.create ?? vi.fn(async () => ({
        kind: "saved",
        article: { ...article, updatedAt: "2026-09-13T00:02:00.000Z" },
        source
      }))) as never
    },
    webSearch: { search: overrides.search ?? vi.fn(async () => [
      { title: "结果一", url: "https://a.example.com", snippet: "片段一" },
      { title: "结果二", url: "https://b.example.com", snippet: "片段二" }
    ]) },
    llm: null
  } as never;
}

function makeRequest(body: unknown, id = "article-1") {
  return new Request(`http://localhost/api/articles/${id}/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const context = { params: Promise.resolve({ id: "article-1" }) };

describe("POST /api/articles/[id]/research", () => {
  it("成功时返回 article、source 与查询信息", async () => {
    const handler = createResearchRouteHandler(dependenciesWith());
    const response = await handler(
      makeRequest({ expectedUpdatedAt: "2026-09-13T00:00:00.000Z" }),
      context
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.queries).toEqual(["t"]);
    expect(payload.resultCount).toBe(2);
    expect((payload.source as { type: string }).type).toBe("web");
    expect((payload.article as { updatedAt: string }).updatedAt).toBe("2026-09-13T00:02:00.000Z");
  });

  it("缺少 expectedUpdatedAt 时返回 400", async () => {
    const handler = createResearchRouteHandler(dependenciesWith());
    const response = await handler(makeRequest({}), context);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("联网搜集资料请求无效");
  });

  it("搜索全部失败时返回 502", async () => {
    const handler = createResearchRouteHandler(dependenciesWith({
      search: async () => {
        throw new Error("down");
      }
    }));
    const response = await handler(
      makeRequest({ expectedUpdatedAt: "2026-09-13T00:00:00.000Z" }),
      context
    );
    expect(response.status).toBe(502);
  });

  it("文章不存在时返回 404", async () => {
    const handler = createResearchRouteHandler(dependenciesWith({ article: null }));
    const response = await handler(
      makeRequest({ expectedUpdatedAt: "2026-09-13T00:00:00.000Z" }, "missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(response.status).toBe(404);
  });

  it("乐观并发冲突时返回 409", async () => {
    const handler = createResearchRouteHandler(dependenciesWith({
      create: async () => ({ kind: "conflict" })
    }));
    const response = await handler(
      makeRequest({ expectedUpdatedAt: "2026-09-13T00:00:00.000Z" }),
      context
    );
    expect(response.status).toBe(409);
  });
});
