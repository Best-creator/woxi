// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { applyOutlineReview } from "./apply-outline-review";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "./demo-outline-agents";
import { generateOutline } from "./generate-outline";
import type { OutlineGenerator, OutlineReviewer } from "./ports";
import { reviewOutline } from "./review-outline";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import type { GenerateOutlineInput, OutlineReviewResult } from "./domain";

const needsRevision: OutlineReviewResult = {
  status: "needs_revision",
  summary: "章节目标不够具体。",
  coverage: 3,
  granularity: 3,
  beginnerFriendliness: 3,
  logicalOrder: 4,
  sourceSupport: null,
  hiddenPrerequisites: [],
  complexDependencies: [],
  issues: [{ sectionKey: "start_with_a_choice", severity: "warning", message: "请用更日常的例子开场。" }]
};

async function reviewedArticle(reviewer: OutlineReviewer = {
  review: async () => needsRevision
}) {
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
  const reviewed = await reviewOutline(
    { articleId: generated.article.id, expectedUpdatedAt: generated.article.updatedAt },
    { articles, sources, reviewer, workflow }
  );
  if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
  return { db, articles, sources, workflow, article: generated.article, review: reviewed.review, revision: reviewed.revision };
}

describe("applyOutlineReview", () => {
  it("rewrites the current outline from review feedback and records a new review_applied version", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle();
    let received: GenerateOutlineInput | undefined;
    const generator: OutlineGenerator = {
      async generate(input) {
        received = input;
        return new DemoOutlineGenerator().generate(input);
      }
    };

    const result = await applyOutlineReview(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, model: "writer-revise" },
      { articles, sources, generator, workflow }
    );

    expect(result).toMatchObject({
      kind: "revised",
      article: { status: "brief_ready", outlineConfirmedAt: null },
      revision: { version: 2, reason: "review_applied", model: "writer-revise" }
    });
    expect(received).toMatchObject({
      topic: "机会成本",
      reviewFeedback: { status: "needs_revision", summary: "章节目标不够具体。" },
      currentBrief: { oneSentence: expect.any(String) },
      currentOutline: expect.arrayContaining([expect.objectContaining({ title: "先看一个熟悉的选择" })])
    });
    if (result.kind === "revised") {
      expect(result.article.outline[0]?.title).not.toBe("先看一个熟悉的选择");
      expect(result.article.planning.confirmedOutlineRevisionId).toBeNull();
      expect(result.article.blocks).toEqual([]);
    }
  });

  it("does not rewrite a passed review or a request without a current review", async () => {
    const passed = await reviewedArticle(new DemoOutlineReviewer());
    const passedResult = await applyOutlineReview(
      { articleId: passed.article.id, expectedUpdatedAt: passed.article.updatedAt },
      { articles: passed.articles, sources: passed.sources, generator: new DemoOutlineGenerator(), workflow: passed.workflow }
    );
    const created = await passed.articles.create({ topic: "沉没成本" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles: passed.articles, sources: passed.sources, generator: new DemoOutlineGenerator(), workflow: passed.workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const noReview = await applyOutlineReview(
      { articleId: generated.article.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles: passed.articles, sources: passed.sources, generator: new DemoOutlineGenerator(), workflow: passed.workflow }
    );

    expect(passedResult).toEqual({ kind: "no_revision_needed" });
    expect(noReview).toEqual({ kind: "review_required" });
  });

  it("does not persist a version when revision generation fails", async () => {
    const { db, articles, sources, workflow, article } = await reviewedArticle();
    const failed: OutlineGenerator = { generate: async () => { throw new Error("invalid schema"); } };

    const result = await applyOutlineReview(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt },
      { articles, sources, generator: failed, workflow }
    );

    expect(result).toEqual({ kind: "generator_error", message: "invalid schema" });
    expect(await workflow.listOutlineVersions(article.id)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()).toEqual({ count: 1 });
  });

  it("revises from the author's own instructions even when the review passed", async () => {
    const passed = await reviewedArticle(new DemoOutlineReviewer());
    let received: GenerateOutlineInput | undefined;
    const generator: OutlineGenerator = {
      async generate(input) {
        received = input;
        return new DemoOutlineGenerator().generate(input);
      }
    };

    const result = await applyOutlineReview(
      {
        articleId: passed.article.id,
        expectedUpdatedAt: passed.article.updatedAt,
        userInstructions: "  把第二章拆开讲透机制  "
      },
      { articles: passed.articles, sources: passed.sources, generator, workflow: passed.workflow }
    );

    expect(result).toMatchObject({ kind: "revised", revision: { version: 2, reason: "review_applied" } });
    // 首尾空白要清掉，避免把空白当成一条有效要求。
    expect(received?.userInstructions).toBe("把第二章拆开讲透机制");
    expect(received?.currentOutline).toBeDefined();
    // 审核通过时仍会把这条结论传下去，但闸门不再拦住用户。
    expect(received?.reviewFeedback).toMatchObject({ status: "passed" });
  });

  it("revises without any review when the author describes what they want", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "沉没成本" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");

    const withoutInstructions = await applyOutlineReview(
      { articleId: generated.article.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    const withInstructions = await applyOutlineReview(
      {
        articleId: generated.article.id,
        expectedUpdatedAt: generated.article.updatedAt,
        userInstructions: "开场换成工位上的场景"
      },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );

    expect(withoutInstructions).toEqual({ kind: "review_required" });
    expect(withInstructions).toMatchObject({ kind: "revised" });
    if (withInstructions.kind === "revised") {
      expect(withInstructions.article.outline[0]?.title).not.toBe("先看一个熟悉的选择");
    }
  });

  it("hands both the review feedback and the author's instructions to the generator", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle();
    let received: GenerateOutlineInput | undefined;
    const generator: OutlineGenerator = {
      async generate(input) {
        received = input;
        return new DemoOutlineGenerator().generate(input);
      }
    };

    const result = await applyOutlineReview(
      {
        articleId: article.id,
        expectedUpdatedAt: article.updatedAt,
        userInstructions: "开场换成一个高频场景"
      },
      { articles, sources, generator, workflow }
    );

    expect(result).toMatchObject({ kind: "revised" });
    expect(received?.reviewFeedback).toMatchObject({ status: "needs_revision", summary: "章节目标不够具体。" });
    expect(received?.userInstructions).toBe("开场换成一个高频场景");
  });

  it("treats whitespace-only instructions as absent and keeps the review gate", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "边际效用" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");

    const result = await applyOutlineReview(
      {
        articleId: generated.article.id,
        expectedUpdatedAt: generated.article.updatedAt,
        userInstructions: "   \n  "
      },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );

    expect(result).toEqual({ kind: "review_required" });
  });
});
