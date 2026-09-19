// @vitest-environment node

import { describe, expect, it } from "vitest";
import { approveContent } from "./approve-content";
import { reviewContent } from "./review-content";
import type { ContentReviewer, ContentReviewStatus } from "./ports";
import { articleWithGeneratedContent } from "../../../tests/helpers/content-fixture";

function reviewerWith(status: ContentReviewStatus, severity: "warning" | "blocking" = "warning"): ContentReviewer {
  return {
    async review() {
      return {
        status,
        summary: `${status} 的演示结论`,
        clarity: 4,
        beginnerFriendliness: 4,
        coherence: 4,
        engagement: 3,
        hookStrength: 3,
        outlineCoverage: 4,
        sourceFidelity: null,
        styleMatch: 4,
        issues: status === "passed" ? [] : [{ blockIds: [], severity, message: "示例问题" }]
      };
    }
  };
}

async function reviewedWith(status: ContentReviewStatus, severity: "warning" | "blocking" = "warning") {
  const fixture = await articleWithGeneratedContent();
  const reviewed = await reviewContent(
    { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
    {
      articles: fixture.articles,
      sources: fixture.sources,
      reviewer: reviewerWith(status, severity),
      workflow: fixture.contentWorkflow
    }
  );
  if (reviewed.kind !== "reviewed") throw new Error("fixture should review");
  return { ...fixture, reviewed };
}

describe("approveContent", () => {
  it("marks the article as content_ready after a passed review", async () => {
    const fixture = await reviewedWith("passed");

    const result = await approveContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, acknowledgeWarnings: false },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({
      kind: "approved",
      article: { status: "content_ready" },
      revision: { scope: "content", version: fixture.reviewed.revision.version }
    });
    expect((await fixture.articles.findById(fixture.article.id))?.status).toBe("content_ready");
  });

  it("blocks approval when the review is blocked", async () => {
    const fixture = await reviewedWith("blocked", "blocking");

    const result = await approveContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, acknowledgeWarnings: true },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "blocked" });
    expect((await fixture.articles.findById(fixture.article.id))?.status).toBe("editing");
  });

  it("requires an explicit acknowledgement before approving needs_revision", async () => {
    const fixture = await reviewedWith("needs_revision");
    const deps = { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow };

    const without = await approveContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, acknowledgeWarnings: false },
      deps
    );
    const withAcknowledgement = await approveContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, acknowledgeWarnings: true },
      deps
    );

    expect(without).toEqual({ kind: "acknowledgement_required" });
    expect(withAcknowledgement).toMatchObject({ kind: "approved", article: { status: "content_ready" } });
  });

  it("approves directly without a review and reports a null review", async () => {
    const fixture = await articleWithGeneratedContent();

    const result = await approveContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, acknowledgeWarnings: true },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({
      kind: "approved",
      article: { status: "content_ready" },
      review: null
    });
    expect((await fixture.articles.findById(fixture.article.id))?.status).toBe("content_ready");
  });

  it("refuses to approve content built on an outdated outline", async () => {
    const fixture = await reviewedWith("passed");
    const stale = {
      ...fixture.article,
      planning: { ...fixture.article.planning, confirmedOutlineRevisionId: "outline-v9" }
    };
    await fixture.articles.save(stale, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const result = await approveContent(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt, acknowledgeWarnings: true },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "stale_outline" });
  });

  it("still approves an edited body without a review by checkpointing first", async () => {
    const fixture = await reviewedWith("passed");
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: `${block.content} 又改了一次`, version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const result = await approveContent(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt, acknowledgeWarnings: true },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );

    // 编辑后旧审核失效，但正文可以直接确认（未审核路径），确认前自动补 checkpoint 修订。
    expect(result).toMatchObject({ kind: "approved", article: { status: "content_ready" }, review: null });
    expect(await fixture.contentWorkflow.listContentVersions(fixture.article.id)).toHaveLength(2);
  });
});
