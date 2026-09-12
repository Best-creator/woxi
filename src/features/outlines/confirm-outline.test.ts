// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import type { OutlineReviewResult } from "./domain";
import { DemoOutlineGenerator } from "./demo-outline-agents";
import { generateOutline } from "./generate-outline";
import { reviewOutline } from "./review-outline";
import { confirmOutline } from "./confirm-outline";
import { SqliteOutlineWorkflowRepository } from "./sqlite-workflow-repository";
import type { OutlineWorkflowRepository } from "./workflow-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

const review = (status: OutlineReviewResult["status"]): OutlineReviewResult => ({
  status,
  summary: "审核结果",
  coverage: 5,
  granularity: 5,
  beginnerFriendliness: 5,
  logicalOrder: 5,
  sourceSupport: null,
  hiddenPrerequisites: [],
  complexDependencies: [],
  issues: status === "blocked" ? [{ sectionKey: "start_with_a_choice", severity: "blocking", message: "必须修订" }] : []
});

async function reviewedArticle(status: OutlineReviewResult["status"]) {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const sources = new SqliteSourceRepository(db);
  const workflow = new SqliteOutlineWorkflowRepository(db);
  const created = await articles.create({ topic: "机会成本" });
  const generated = await generateOutline({ articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
  if (generated.kind !== "generated") throw new Error("fixture should generate");
  await reviewOutline(
    { articleId: created.id, expectedUpdatedAt: generated.article.updatedAt },
    { articles, sources, reviewer: { review: async () => review(status) }, workflow }
  );
  return { articles, sources, workflow, article: generated.article };
}

function workflowWithReviewLookupHook(
  workflow: SqliteOutlineWorkflowRepository,
  hook: (current: Awaited<ReturnType<OutlineWorkflowRepository["findCurrentOutlineReview"]>>) => Promise<void>
): OutlineWorkflowRepository {
  return {
    saveGeneratedOutline: workflow.saveGeneratedOutline.bind(workflow),
    checkpointOutline: workflow.checkpointOutline.bind(workflow),
    saveOutlineReview: workflow.saveOutlineReview.bind(workflow),
    async findCurrentOutlineReview(input) {
      const current = await workflow.findCurrentOutlineReview(input);
      await hook(current);
      return current;
    },
    confirmOutline: workflow.confirmOutline.bind(workflow),
    saveManualOutlineVersion: workflow.saveManualOutlineVersion.bind(workflow),
    restoreOutline: workflow.restoreOutline.bind(workflow),
    listOutlineVersions: workflow.listOutlineVersions.bind(workflow),
    listOutlineReviews: workflow.listOutlineReviews.bind(workflow)
  };
}

describe("confirmOutline", () => {
  it("confirms an exact current snapshot and preserves its reviewed revision", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle("passed");
    const result = await confirmOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, acknowledgeWarnings: false },
      { articles, sources, workflow }
    );

    expect(result).toMatchObject({
      kind: "confirmed",
      article: { status: "outline_ready", planning: { confirmedOutlineRevisionId: expect.any(String) } },
      revision: { version: 1 },
      review: { result: { status: "passed" } }
    });
  });

  it("clears leftover article blocks when confirming a newly generated outline", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle("passed");
    const seeded = await articles.save(
      {
        ...article,
        blocks: [
          {
            id: "legacy-demo",
            type: "heading",
            content: `用大白话讲清楚：${article.topic}`,
            order: 0,
            version: 1,
            level: 1
          },
          {
            id: "legacy-paragraph",
            type: "paragraph",
            content: `${article.topic}可以从“它是什么、为什么重要、如何影响日常选择”三个角度理解。`,
            order: 1,
            version: 1
          }
        ],
        status: "editing"
      },
      article.updatedAt
    );
    if (seeded.kind !== "saved") throw new Error("fixture should save leftover blocks");

    const result = await confirmOutline(
      { articleId: seeded.article.id, expectedUpdatedAt: seeded.article.updatedAt, acknowledgeWarnings: false },
      { articles, sources, workflow }
    );

    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("expected confirmation");
    expect(result.article.blocks).toEqual([]);
    expect(result.article.status).toBe("outline_ready");
    expect(result.article.planning.contentOutlineRevisionId).toBeNull();
    expect((await articles.findById(seeded.article.id))?.blocks).toEqual([]);
  });

  it("blocks blocked reviews and requires acknowledgement for needs_revision without mutating the article", async () => {
    const blocked = await reviewedArticle("blocked");
    const blockedResult = await confirmOutline(
      { articleId: blocked.article.id, expectedUpdatedAt: blocked.article.updatedAt, acknowledgeWarnings: true },
      { articles: blocked.articles, sources: blocked.sources, workflow: blocked.workflow }
    );
    const warning = await reviewedArticle("needs_revision");
    const warningResult = await confirmOutline(
      { articleId: warning.article.id, expectedUpdatedAt: warning.article.updatedAt, acknowledgeWarnings: false },
      { articles: warning.articles, sources: warning.sources, workflow: warning.workflow }
    );

    expect(blockedResult).toEqual({ kind: "blocked" });
    expect(warningResult).toEqual({ kind: "acknowledgement_required" });
    expect((await blocked.articles.findById(blocked.article.id))?.outlineConfirmedAt).toBeNull();
    expect((await warning.articles.findById(warning.article.id))?.outlineConfirmedAt).toBeNull();
  });

  it("rejects confirmation when a source changes after the review lookup but before the confirmation transaction", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle("passed");
    const raceWorkflow = workflowWithReviewLookupHook(workflow, async () => {
        await sources.create({
          articleId: article.id,
          title: "并发资料",
          type: "text",
          content: "在确认前新增的资料"
        });
      });

    const result = await confirmOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, acknowledgeWarnings: false },
      { articles, sources, workflow: raceWorkflow }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect((await articles.findById(article.id))?.outlineConfirmedAt).toBeNull();
  });

  it("rejects confirmation when a newer review supersedes the reviewed result before confirmation", async () => {
    const { articles, sources, workflow, article } = await reviewedArticle("passed");
    const blockedReview = review("blocked");
    const raceWorkflow = workflowWithReviewLookupHook(workflow, async (current) => {
        if (!current) return;
        await workflow.saveOutlineReview({
          revisionId: current.revision.id,
          model: "reviewer-b",
          result: blockedReview
        });
      });

    const result = await confirmOutline(
      { articleId: article.id, expectedUpdatedAt: article.updatedAt, acknowledgeWarnings: false },
      { articles, sources, workflow: raceWorkflow }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect((await articles.findById(article.id))?.outlineConfirmedAt).toBeNull();
  });
});
