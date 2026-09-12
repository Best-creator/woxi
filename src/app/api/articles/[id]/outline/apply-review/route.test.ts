// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { generateOutline } from "@/features/outlines/generate-outline";
import type { OutlineReviewer } from "@/features/outlines/ports";
import { reviewOutline } from "@/features/outlines/review-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createOutlineApplyReviewRouteHandler } from "./route";

const needsRevisionReviewer: OutlineReviewer = {
  async review() {
    return {
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
  }
};

describe("outline apply-review route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("rewrites a needs-revision outline and maps missing review to 400", async () => {
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
    const handler = createOutlineApplyReviewRouteHandler({ articles, sources, generator: new DemoOutlineGenerator(), workflow });
    const missingReview = await handler(
      requestJson("http://test/outline/apply-review", { expectedUpdatedAt: generated.article.updatedAt }),
      context(created.id)
    );
    const reviewed = await reviewOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, reviewer: needsRevisionReviewer, workflow }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
    const applied = await handler(
      requestJson("http://test/outline/apply-review", { expectedUpdatedAt: generated.article.updatedAt }),
      context(created.id)
    );

    expect(missingReview.status).toBe(400);
    expect(applied.status).toBe(200);
    expect((await applied.json()).revision).toMatchObject({ reason: "review_applied", version: 2 });
  });

  it("maps a passed review to 400 and generator failures to 502", async () => {
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
    await reviewOutline(
      { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
      { articles, sources, reviewer: new DemoOutlineReviewer(), workflow }
    );
    const passed = await createOutlineApplyReviewRouteHandler({ articles, sources, generator: new DemoOutlineGenerator(), workflow })(
      requestJson("http://test/outline/apply-review", { expectedUpdatedAt: generated.article.updatedAt }),
      context(created.id)
    );
    const failedArticle = await articles.create({ topic: "沉没成本" });
    const failedGenerated = await generateOutline(
      { articleId: failedArticle.id, expectedUpdatedAt: failedArticle.updatedAt, lengthPreset: "standard" },
      { articles, sources, generator: new DemoOutlineGenerator(), workflow }
    );
    if (failedGenerated.kind !== "generated") throw new Error("fixture should generate");
    await reviewOutline(
      { articleId: failedArticle.id, expectedUpdatedAt: failedGenerated.article.updatedAt },
      { articles, sources, reviewer: needsRevisionReviewer, workflow }
    );
    const failed = await createOutlineApplyReviewRouteHandler({
      articles,
      sources,
      generator: { generate: async () => { throw new Error("upstream"); } },
      workflow
    })(
      requestJson("http://test/outline/apply-review", { expectedUpdatedAt: failedGenerated.article.updatedAt }),
      context(failedArticle.id)
    );

    expect(passed.status).toBe(400);
    expect(failed.status).toBe(502);
  });
});
