import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { collectWebResearch, type WebResearchLlmClient } from "./collect-web-research";
import type { Article } from "@/features/articles/domain";
import type { SourceDocument } from "@/features/sources/domain";

function articleFixture(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    title: "为什么天空是蓝色的",
    topic: "为什么天空是蓝色的",
    status: "draft",
    brief: null,
    outline: [],
    blocks: [],
    planning: {},
    styleProfile: null,
    outlineConfirmedAt: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides
  } as Article;
}

function sourceFixture(): SourceDocument {
  return {
    id: "source-1",
    articleId: "article-1",
    title: "AI 联网资料：为什么天空是蓝色的",
    type: "web",
    content: "# 联网资料",
    status: "ready",
    enabled: true,
    createdAt: "2026-09-13T00:01:00.000Z",
    updatedAt: "2026-09-13T00:01:00.000Z"
  };
}

function llmStub(handler: (systemPrompt: string) => unknown): WebResearchLlmClient {
  return {
    complete: (async ({ schema, systemPrompt }: { schema: z.ZodType<unknown>; systemPrompt: string }) => {
      return schema.parse(handler(systemPrompt));
    }) as WebResearchLlmClient["complete"]
  };
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    articles: { findById: vi.fn(async () => articleFixture()) },
    workflow: {
      create: vi.fn(async () => ({ kind: "saved", article: articleFixture({ updatedAt: "2026-09-13T00:02:00.000Z" }), source: sourceFixture() }))
    },
    webSearch: { search: vi.fn(async () => [{ title: "结果A", url: "https://a.example.com", snippet: "片段A" }]) },
    ...overrides
  };
}

describe("collectWebResearch", () => {
  it("有 LLM 时：生成查询 → 搜索 → 汇总 → 存为 web 资料", async () => {
    let call = 0;
    const llm = llmStub(() => {
      call += 1;
      return call === 1 ? { queries: ["瑞利散射", "天空颜色", "光的波长"] } : { markdown: "# 整理后的资料" };
    });
    const dependencies = baseDependencies({ llm, defaultModel: "grok-4.6" });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result.queries).toEqual(["瑞利散射", "天空颜色", "光的波长"]);
    expect(result.source.type).toBe("web");
    expect(result.article.updatedAt).toBe("2026-09-13T00:02:00.000Z");
    expect(dependencies.workflow.create).toHaveBeenCalledWith("article-1", "2026-09-13T00:00:00.000Z", {
      title: expect.stringContaining("AI 联网资料"),
      type: "web",
      content: "# 整理后的资料"
    });
    expect(dependencies.webSearch.search).toHaveBeenCalledTimes(3);
  });

  it("无 LLM 时：直接用知识点搜索并输出原始结果", async () => {
    const dependencies = baseDependencies({ llm: null });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result.queries).toEqual(["为什么天空是蓝色的".slice(0, 20)]);
    expect(dependencies.workflow.create).toHaveBeenCalledWith(
      "article-1",
      "2026-09-13T00:00:00.000Z",
      expect.objectContaining({
        type: "web",
        content: expect.stringContaining("来源：https://a.example.com")
      })
    );
    const createCall = (dependencies.workflow.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2].content).toContain("未经模型整理");
  });

  it("LLM 查询生成失败时降级为直接搜索知识点", async () => {
    let queryCallFailed = false;
    const llm: WebResearchLlmClient = {
      complete: (async ({ schema }: { schema: z.ZodType<unknown> }) => {
        // 第一次调用（查询生成）抛错；之后（汇总）正常返回。
        if (!queryCallFailed) {
          queryCallFailed = true;
          throw new Error("llm down");
        }
        return schema.parse({ markdown: "# 汇总" });
      }) as WebResearchLlmClient["complete"]
    };
    const dependencies = baseDependencies({ llm });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result.queries).toEqual(["为什么天空是蓝色的".slice(0, 20)]);
  });

  it("所有查询都搜索失败时返回 search_unavailable", async () => {
    const dependencies = baseDependencies({
      webSearch: { search: vi.fn(async () => { throw new Error("down"); }) }
    });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("search_unavailable");
  });

  it("文章不存在时返回 not_found", async () => {
    const dependencies = baseDependencies({
      articles: { findById: vi.fn(async () => null) }
    });
    const result = await collectWebResearch(
      { articleId: "missing", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );
    expect(result.kind).toBe("not_found");
  });

  it("乐观并发冲突时返回 conflict", async () => {
    const dependencies = baseDependencies({
      workflow: { create: vi.fn(async () => ({ kind: "conflict" })) }
    });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );
    expect(result.kind).toBe("conflict");
  });

  it("搜索结果按标题去重", async () => {
    const dependencies = baseDependencies({
      webSearch: {
        search: vi.fn(async () => [
          { title: "重复标题", url: "https://a.example.com", snippet: "1" },
          { title: "重复标题", url: "https://b.example.com", snippet: "2" }
        ])
      }
    });
    const result = await collectWebResearch(
      { articleId: "article-1", expectedUpdatedAt: "2026-09-13T00:00:00.000Z" },
      dependencies as never
    );
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result.resultCount).toBe(1);
  });
});
