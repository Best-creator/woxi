// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { generateOutline } from "@/features/outlines/generate-outline";
import { reviewOutline } from "@/features/outlines/review-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { createTestDatabase } from "../../../../tests/helpers/test-db";
import { loadOutlineWorkspaceState } from "./outline-state";

describe("loadOutlineWorkspaceState", () => {
  it("reloads saved outline versions and the current review", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const reviewed = await reviewOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
    const article = await articles.findById(created.id);
    if (!article) throw new Error("fixture should keep the article");

    const state = await loadOutlineWorkspaceState({
      article,
      sources: await sources.list(created.id),
      workflow
    });

    expect(state.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generated.revision.id }),
      expect.objectContaining({ id: reviewed.revision.id })
    ]));
    expect(state.review).toMatchObject({
      revision: { id: reviewed.revision.id },
      review: { id: reviewed.review.id, result: { status: "passed" } }
    });
    expect(state.versionReviews).toMatchObject({
      [reviewed.revision.id]: { id: reviewed.review.id, result: { status: "passed" } }
    });
  });

  it("keeps historical reviews after a later outline rewrite", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const reviewed = await reviewOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
    const rewritten = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt, lengthPreset: "deep" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (rewritten.kind !== "generated") throw new Error("fixture should rewrite");
    const article = await articles.findById(created.id);
    if (!article) throw new Error("fixture should keep the article");

    const state = await loadOutlineWorkspaceState({
      article,
      sources: await sources.list(created.id),
      workflow
    });

    expect(state.review).toBeNull();
    expect(state.versionReviews[reviewed.revision.id]).toMatchObject({
      id: reviewed.review.id,
      result: { status: "passed" }
    });
    expect(state.versionReviews[rewritten.revision.id]).toBeUndefined();
  });

  it("attaches a restored copy to the original version's review", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const generated = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const reviewed = await reviewOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
    const rewritten = await generateOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt, lengthPreset: "deep" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (rewritten.kind !== "generated") throw new Error("fixture should rewrite");
    const restored = await workflow.restoreOutline({
      articleId: created.id,
      versionId: generated.revision.id,
      expectedUpdatedAt: rewritten.article.updatedAt
    });
    if (restored.kind !== "restored") throw new Error("fixture should restore");
    const article = await articles.findById(created.id);
    if (!article) throw new Error("fixture should keep the article");

    const state = await loadOutlineWorkspaceState({
      article,
      sources: await sources.list(created.id),
      workflow
    });

    expect(state.versionReviews[restored.revision.id]).toMatchObject({
      id: reviewed.review.id,
      result: { status: "passed" }
    });
    expect(state.review).toBeNull();
  });
});
