// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "./demo-outline-agents";
import type { OutlineReviewer } from "./ports";
import { generateOutline } from "./generate-outline";
import { reviewOutline } from "./review-outline";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

async function generatedArticle() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const sources = new SqliteSourceRepository(db);
  const workflow = new SqliteOutlineWorkflowRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  const generated = await generateOutline(
    { articleId: article.id, expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" },
    { articles, sources, generator: new DemoOutlineGenerator(), workflow }
  );
  if (generated.kind !== "generated") throw new Error("fixture should generate");
  return { db, articles, sources, workflow, article: generated.article, revision: generated.revision };
}

describe("reviewOutline", () => {
  it("checkpoints the current snapshot and binds the independent review to it", async () => {
    const { articles, sources, workflow, article, revision } = await generatedArticle();
    const result = await reviewOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, model: "reviewer" },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow }
    );

    expect(result).toMatchObject({
      kind: "reviewed",
      revision: { id: revision.id, version: 1 },
      review: { revisionId: revision.id, model: "reviewer", result: { status: "passed" } }
    });
  });

  it("passes the current brief and length constraints to the independent reviewer", async () => {
    const { articles, sources, workflow, article } = await generatedArticle();
    let received: Record<string, unknown> | undefined;
    const reviewer: OutlineReviewer = {
      async review(input) {
        received = input as unknown as Record<string, unknown>;
        return new DemoOutlineReviewer().review(input);
      }
    };

    await reviewOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt },
      { articles, sources, reviewer, workflow }
    );

    expect(received).toMatchObject({
      topic: "机会成本",
      targetAudience: "对该知识点零基础的普通读者",
      lengthPreset: "standard",
      recommendedTotalWords: 1200,
      brief: { oneSentence: expect.any(String) }
    });
  });

  it("creates a checkpoint for edited outline or enabled source changes but not repeated unchanged reviews", async () => {
    const { articles, sources, workflow, article } = await generatedArticle();
    const reviewer = new DemoOutlineReviewer();
    const first = await reviewOutline({ articleId: article.id, expectedUpdatedAt: article.updatedAt }, { articles, sources, reviewer, workflow });
    if (first.kind !== "reviewed") throw new Error("fixture should review");
    const second = await reviewOutline({ articleId: article.id, expectedUpdatedAt: article.updatedAt }, { articles, sources, reviewer, workflow });
    const source = await sources.create({ articleId: article.id, title: "资料", type: "text", content: "新的资料" });
    const third = await reviewOutline({ articleId: article.id, expectedUpdatedAt: article.updatedAt }, { articles, sources, reviewer, workflow });

    expect(second).toMatchObject({ kind: "reviewed", revision: { id: first.revision.id, version: 1 } });
    expect(third).toMatchObject({ kind: "reviewed", revision: { version: 2 } });
    expect(source.enabled).toBe(true);
  });

  it("does not checkpoint when the article is missing, stale, or has no outline", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const missing = await reviewOutline({ articleId: "missing", expectedUpdatedAt: article.updatedAt }, { articles, sources, reviewer: new DemoOutlineReviewer(), workflow });
    const stale = await reviewOutline({ articleId: article.id, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }, { articles, sources, reviewer: new DemoOutlineReviewer(), workflow });
    const noOutline = await reviewOutline({ articleId: article.id, expectedUpdatedAt: article.updatedAt }, { articles, sources, reviewer: new DemoOutlineReviewer(), workflow });

    expect(missing).toEqual({ kind: "not_found" });
    expect(stale).toEqual({ kind: "conflict" });
    expect(noOutline).toEqual({ kind: "no_outline" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()).toEqual({ count: 0 });
  });

  it("records the resolved default reviewer model instead of an audit placeholder", async () => {
    const { articles, sources, workflow, article } = await generatedArticle();
    const result = await reviewOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow, defaultModel: "reviewer-default" }
    );

    expect(result).toMatchObject({ kind: "reviewed", review: { model: "reviewer-default" } });
  });
});
