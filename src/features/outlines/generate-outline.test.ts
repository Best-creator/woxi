// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import type { OutlineGenerator } from "./ports";
import { DemoOutlineGenerator } from "./demo-outline-agents";
import { generateOutline } from "./generate-outline";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const sources = new SqliteSourceRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  return { db, articles, sources, article, workflow: new SqliteOutlineWorkflowRepository(db) };
}

describe("generateOutline", () => {
  it("generates a brief, persistent section ids, and the first immutable version", async () => {
    const { articles, sources, article, workflow } = await setup();
    await sources.create({ articleId: article.id, title: "可用资料", type: "text", content: "已启用内容" });
    const disabled = await sources.create({ articleId: article.id, title: "停用资料", type: "text", content: "不得传递" });
    await sources.updateEnabled(article.id, disabled.id, false);
    await sources.create({ articleId: article.id, title: "未就绪资料", type: "pdf", content: "不得传递" });
    let sourceContext = "";
    const generator: OutlineGenerator = {
      async generate(input) {
        sourceContext = input.sourceContext ?? "";
        return new DemoOutlineGenerator().generate(input);
      }
    };

    const result = await generateOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, model: "demo", lengthPreset: "short" },
      { articles, sources, generator, workflow }
    );

    expect(result).toMatchObject({
      kind: "generated",
      article: { status: "brief_ready", planning: { lengthPreset: "short" } },
      revision: { version: 1, reason: "generated" }
    });
    expect(sourceContext).toContain("已启用内容");
    expect(sourceContext).not.toContain("不得传递");
    if (result.kind === "generated") {
      expect(result.article.outline.every((section) => section.id.length > 0)).toBe(true);
    }
  });

  it("truncates the assembled eligible source context to 8000 characters", async () => {
    const { articles, sources, article, workflow } = await setup();
    await sources.create({ articleId: article.id, title: "很长资料", type: "text", content: "x".repeat(9_000) });
    let contextLength = 0;
    const generator: OutlineGenerator = {
      async generate(input) {
        contextLength = input.sourceContext?.length ?? 0;
        return new DemoOutlineGenerator().generate(input);
      }
    };

    await generateOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator, workflow }
    );

    expect(contextLength).toBe(8_000);
  });

  it("does not persist a version when generation fails or the request is stale", async () => {
    const { db, articles, sources, article, workflow } = await setup();
    const failed: OutlineGenerator = { generate: async () => { throw new Error("invalid schema"); } };
    const failure = await generateOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: failed, workflow }
    );
    const stale = await generateOutline(
      { articleId: article.id, expectedUpdatedAt: "2026-01-01T00:00:00.000Z", lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );

    expect(failure.kind).toBe("generator_error");
    expect(stale).toEqual({ kind: "conflict" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()).toEqual({ count: 0 });
  });

  it("records the selected model or the resolved default model on generated revisions", async () => {
    const { articles, sources, article, workflow } = await setup();
    const defaulted = await generateOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow, defaultModel: "writer-default" }
    );
    if (defaulted.kind !== "generated") throw new Error("fixture should generate");
    await sources.create({ articleId: article.id, title: "新资料", type: "text", content: "让快照产生新版本" });
    const selected = await generateOutline(
      { articleId: article.id, expectedUpdatedAt: defaulted.article.updatedAt, model: "writer-selected", lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow, defaultModel: "writer-default" }
    );

    expect(defaulted.revision.model).toBe("writer-default");
    expect(selected).toMatchObject({ kind: "generated", revision: { version: 2, model: "writer-selected" } });
  });
});
