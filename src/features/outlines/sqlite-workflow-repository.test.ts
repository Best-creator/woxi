// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { OutlineRevisionSnapshot } from "@/features/revisions/domain";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";

function snapshot(title = "机会成本"): OutlineRevisionSnapshot {
  return {
    title,
    brief: {
      oneSentence: "机会成本是放弃的最佳替代方案。",
      concepts: ["选择"],
      prerequisites: [],
      misconceptions: [],
      analogies: [],
      unsupportedNotes: []
    },
    outline: [{ id: "section-1", title: "从选择开始", goal: "建立直觉", recommendedWords: 1000, order: 0 }],
    lengthPreset: "standard",
    recommendedTotalWords: 1000,
    sourceContextSnapshot: ""
  };
}

describe("SqliteOutlineWorkflowRepository", () => {
  it("atomically saves the generated draft together with its first revision", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const result = await workflow.saveGeneratedOutline({
      articleId: article.id,
      expectedUpdatedAt: article.updatedAt,
      model: "demo",
      ...snapshot()
    });

    expect(result).toMatchObject({ kind: "saved", article: { status: "brief_ready" }, revision: { version: 1 } });
    expect(await workflow.listOutlineVersions(article.id)).toHaveLength(1);
  });

  it("clears leftover article blocks when a new outline is generated", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const seeded = await articles.save(
      {
        ...created,
        blocks: [
          {
            id: "legacy-demo",
            type: "paragraph",
            content: "用大白话讲清楚：机会成本可以从“它是什么、为什么重要、如何影响日常选择”三个角度理解。",
            order: 0,
            version: 1
          }
        ],
        status: "editing"
      },
      created.updatedAt
    );
    if (seeded.kind !== "saved") throw new Error("fixture should save leftover blocks");

    const result = await workflow.saveGeneratedOutline({
      articleId: seeded.article.id,
      expectedUpdatedAt: seeded.article.updatedAt,
      model: "writer-pro",
      ...snapshot()
    });

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") throw new Error("expected saved outline");
    expect(result.article.blocks).toEqual([]);
    expect(result.article.planning.contentOutlineRevisionId).toBeNull();
    expect((await articles.findById(seeded.article.id))?.blocks).toEqual([]);
  });

  it("does not create a manual revision when the optimistic article version is stale", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const result = await workflow.saveManualOutlineVersion({
      articleId: article.id,
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      model: "manual-default",
      ...snapshot()
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(await workflow.listOutlineVersions(article.id)).toEqual([]);
  });

  it("rolls back the revision when the aggregate article update cannot be applied", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    db.exec(`
      CREATE TRIGGER reject_outline_article_write
      BEFORE UPDATE ON articles
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    const result = await workflow.saveGeneratedOutline({
      articleId: article.id,
      expectedUpdatedAt: article.updatedAt,
      model: "demo",
      ...snapshot()
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(await workflow.listOutlineVersions(article.id)).toEqual([]);
  });

  it("rolls back a restored revision when applying the historical draft fails", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const generated = await workflow.saveGeneratedOutline({
      articleId: article.id,
      expectedUpdatedAt: article.updatedAt,
      model: "demo",
      ...snapshot()
    });
    if (generated.kind !== "saved") throw new Error("fixture should save");
    db.exec(`
      CREATE TRIGGER reject_restored_article_write
      BEFORE UPDATE ON articles
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    const result = await workflow.restoreOutline({
      articleId: article.id,
      versionId: generated.revision.id,
      expectedUpdatedAt: generated.article.updatedAt
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(await workflow.listOutlineVersions(article.id)).toHaveLength(1);
  });

  it("lists the latest review for each outline version", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const first = await workflow.saveGeneratedOutline({
      articleId: article.id,
      expectedUpdatedAt: article.updatedAt,
      model: "demo",
      ...snapshot()
    });
    if (first.kind !== "saved") throw new Error("fixture should save");
    const firstReview = await workflow.saveOutlineReview({
      revisionId: first.revision.id,
      model: "demo",
      result: {
        status: "needs_revision",
        summary: "请补充日常例子。",
        coverage: 3,
        granularity: 3,
        beginnerFriendliness: 3,
        logicalOrder: 4,
        sourceSupport: null,
        hiddenPrerequisites: [],
        complexDependencies: [],
        issues: []
      }
    });
    const second = await workflow.saveGeneratedOutline({
      articleId: first.article.id,
      expectedUpdatedAt: first.article.updatedAt,
      model: "demo",
      ...snapshot("用日常选择理解机会成本")
    });
    if (second.kind !== "saved") throw new Error("fixture should rewrite");

    expect(await workflow.listOutlineReviews(article.id)).toEqual([firstReview]);
  });
});
