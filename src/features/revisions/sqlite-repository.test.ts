// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { migrateDatabase } from "@/server/db";
import { hashSnapshot } from "./content-hash";
import type { OutlineRevisionSnapshot } from "./domain";
import { SqliteRevisionRepository } from "./sqlite-repository";
import { createRevisionIfChangedInTransaction } from "./sqlite-store";
import { createTestDatabase } from "../../../tests/helpers/test-db";

function snapshot(title = "机会成本"): OutlineRevisionSnapshot {
  return {
    title,
    brief: {
      oneSentence: "机会成本是放弃的最佳替代方案。",
      concepts: ["选择", "取舍"],
      prerequisites: [],
      misconceptions: [],
      analogies: [],
      unsupportedNotes: []
    },
    outline: [
      {
        id: "section-1",
        title: "从选择开始",
        goal: "建立取舍直觉",
        recommendedWords: 300,
        order: 0
      }
    ],
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    sourceContextSnapshot: "机会成本是放弃的最佳替代方案。"
  };
}

async function createRepositories() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const revisions = new SqliteRevisionRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  return { db, articles, revisions, article };
}

describe("revision persistence", () => {
  it("normalizes object key order but retains array order when hashing snapshots", () => {
    expect(hashSnapshot({ b: ["first", "second"], a: { z: 2, y: 1 } })).toBe(
      hashSnapshot({ a: { y: 1, z: 2 }, b: ["first", "second"] })
    );
    expect(hashSnapshot({ items: ["first", "second"] })).not.toBe(
      hashSnapshot({ items: ["second", "first"] })
    );
  });

  it("reuses an unchanged latest snapshot instead of allocating a new version", async () => {
    const { revisions, article } = await createRepositories();
    const first = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot(),
      model: "grok-4.6",
      reason: "generated"
    });
    const duplicate = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot(),
      model: "grok-4.6",
      reason: "review_checkpoint"
    });

    expect(first).toMatchObject({ created: true, revision: { version: 1 } });
    expect(duplicate).toMatchObject({ created: false, revision: { version: 1 } });
    expect(await revisions.list(article.id, "outline")).toHaveLength(1);
  });

  it("numbers each article scope independently", async () => {
    const { revisions, article } = await createRepositories();
    const outlineFirst = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot(),
      model: null,
      reason: "generated"
    });
    const contentFirst = await revisions.createIfChanged({
      articleId: article.id,
      scope: "content",
      snapshot: { blocks: ["正文 v1"] },
      model: null,
      reason: "generated"
    });
    const outlineSecond = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot("沉没成本"),
      model: null,
      reason: "manual"
    });

    expect(outlineFirst).toMatchObject({ revision: { version: 1 } });
    expect(contentFirst).toMatchObject({ revision: { version: 1 } });
    expect(outlineSecond).toMatchObject({ revision: { version: 2 } });
  });

  it("binds many reviews to one immutable revision and returns the newest", async () => {
    const { revisions, article } = await createRepositories();
    const created = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot(),
      model: "grok-4.6",
      reason: "review_checkpoint"
    });
    if ("kind" in created) throw new Error("revision creation should not conflict");
    const firstReview = await revisions.saveReview({
      revisionId: created.revision.id,
      model: "reviewer-a",
      result: { verdict: "needs_revision" }
    });
    const latestReview = await revisions.saveReview({
      revisionId: created.revision.id,
      model: "reviewer-b",
      result: { verdict: "approved" }
    });

    expect(firstReview.revisionId).toBe(created.revision.id);
    expect(latestReview.revisionId).toBe(created.revision.id);
    expect(await revisions.latestReview(created.revision.id)).toEqual(latestReview);
  });

  it("cascades revision history and attached reviews when an article is deleted", async () => {
    const { db, revisions, article } = await createRepositories();
    const created = await revisions.createIfChanged({
      articleId: article.id,
      scope: "outline",
      snapshot: snapshot(),
      model: null,
      reason: "generated"
    });
    if ("kind" in created) throw new Error("revision creation should not conflict");
    await revisions.saveReview({
      revisionId: created.revision.id,
      model: "reviewer",
      result: { verdict: "approved" }
    });

    db.prepare("DELETE FROM articles WHERE id = ?").run(article.id);

    expect(await revisions.list(article.id, "outline")).toEqual([]);
    expect(await revisions.findById(created.revision.id)).toBeNull();
    expect(await revisions.latestReview(created.revision.id)).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM article_reviews").get()
    ).toEqual({ count: 0 });
  });

  it("creates a revision inside a caller-owned transaction without nesting one", async () => {
    const { db, revisions, article } = await createRepositories();

    db.exec("BEGIN IMMEDIATE");
    try {
      const created = createRevisionIfChangedInTransaction(db, {
        articleId: article.id,
        scope: "outline",
        snapshot: snapshot(),
        model: null,
        reason: "confirmed"
      });
      expect(created).toMatchObject({ created: true, revision: { version: 1 } });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    expect(await revisions.list(article.id, "outline")).toHaveLength(1);
  });

  it("keeps revision constraints after an idempotent migration", async () => {
    const { db, article } = await createRepositories();
    migrateDatabase(db);

    db.exec("BEGIN IMMEDIATE");
    try {
      createRevisionIfChangedInTransaction(db, {
        articleId: article.id,
        scope: "outline",
        snapshot: snapshot(),
        model: null,
        reason: "generated"
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    expect(() =>
      db.prepare(
        `INSERT INTO article_revisions (
          id, article_id, scope, version_number, content_hash, snapshot_json,
          model, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "duplicate-version",
        article.id,
        "outline",
        1,
        "different-hash",
        "{}",
        null,
        "manual",
        "2026-09-10T00:00:00.000Z"
      )
    ).toThrow(/UNIQUE constraint failed/);

    db.prepare("DELETE FROM articles WHERE id = ?").run(article.id);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()
    ).toEqual({ count: 0 });
  });
});
