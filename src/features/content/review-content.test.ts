// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentReviewer } from "./demo-content-agents";
import { DemoStoryboardDesigner } from "./demo-storyboard-designer";
import { generateContent } from "./generate-content";
import { reviewContent } from "./review-content";
import { resolveStyleProfile } from "./style-profile";
import type { ContentReviewer } from "./ports";
import { articleWithConfirmedOutline, articleWithGeneratedContent } from "../../../tests/helpers/content-fixture";

/** 大纲与正文审核共用 article_reviews 表，统计时需要按 revision scope 过滤。 */
function contentReviewCount(db: ContentFixtureDb): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM article_reviews reviews
       JOIN article_revisions revisions ON revisions.id = reviews.revision_id
       WHERE revisions.scope = 'content'`
    )
    .get() as unknown as { count: number };
  return row.count;
}

type ContentFixtureDb = Awaited<ReturnType<typeof articleWithConfirmedOutline>>["db"];

describe("reviewContent", () => {
  it("checkpoints the current draft and binds the independent review to it", async () => {
    const fixture = await articleWithGeneratedContent();
    const result = await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, model: "reviewer" },
      { articles: fixture.articles, sources: fixture.sources, reviewer: fixture.reviewer, workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({
      kind: "reviewed",
      revision: { id: fixture.contentRevision.id, scope: "content", version: 1 },
      review: { revisionId: fixture.contentRevision.id, model: "reviewer", result: { status: "passed" } }
    });
  });

  it("reuses the same content revision when nothing changed", async () => {
    const fixture = await articleWithGeneratedContent();
    const deps = {
      articles: fixture.articles,
      sources: fixture.sources,
      reviewer: fixture.reviewer,
      workflow: fixture.contentWorkflow
    };

    const first = await reviewContent({ articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt }, deps);
    const second = await reviewContent({ articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt }, deps);

    expect(first).toMatchObject({ kind: "reviewed", revision: { version: 1 } });
    expect(second).toMatchObject({ kind: "reviewed", revision: { version: 1 } });
    await expect(fixture.contentWorkflow.listContentVersions(fixture.article.id)).resolves.toHaveLength(1);
  });

  it("tells the reviewer which form it is reviewing", async () => {
    const fixture = await articleWithGeneratedContent();
    const seen: Array<{ presentation?: string }> = [];
    const reviewer: ContentReviewer = {
      async review(input) {
        seen.push({ presentation: input.presentation });
        return fixture.reviewer.review(input);
      }
    };

    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer, workflow: fixture.contentWorkflow }
    );

    // 新文默认剧情漫画：审核也会按剧情漫画的红线走（sanitizeContentReview 的补检同源）。
    expect(seen).toEqual([{ presentation: "story_comic" }]);
  });

  it("creates a new content revision after the body is edited", async () => {
    const fixture = await articleWithGeneratedContent();
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: `${block.content} 人工修改`, version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const result = await reviewContent(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: fixture.reviewer, workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({ kind: "reviewed", revision: { version: 2 } });
  });

  it("refuses to review content that depends on an outdated outline", async () => {
    const fixture = await articleWithGeneratedContent();
    const stale = { ...fixture.article, planning: { ...fixture.article.planning, confirmedOutlineRevisionId: "outline-v9" } };
    await fixture.articles.save(stale, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const result = await reviewContent(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: fixture.reviewer, workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "stale_outline" });
  });

  it("reports reviewer failures without saving a review", async () => {
    const fixture = await articleWithGeneratedContent();
    const failing: ContentReviewer = {
      async review() {
        throw new Error("审核服务超时");
      }
    };

    const result = await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: failing, workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "reviewer_error", message: "审核服务超时" });
    // 大纲审核已写入一行 review，这里只断言「没有新增正文审核」。
    expect(contentReviewCount(fixture.db)).toBe(0);
  });

  it("refuses to review before any content exists", async () => {
    const fixture = await articleWithConfirmedOutline();

    const result = await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: new DemoContentReviewer(), workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "not_ready" });
  });

  it("keeps the style profile of the reviewed revision for later restore", async () => {
    const fixture = await articleWithConfirmedOutline();
    const styleProfile = resolveStyleProfile("knowledge_cards", "一句一条");
    await generateContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, styleProfile },
      { articles: fixture.articles, sources: fixture.sources, designer: new DemoStoryboardDesigner(), workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const result = await reviewContent(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: { async review() { return {
        status: "passed" as const,
        summary: "通过",
        clarity: 5,
        beginnerFriendliness: 5,
        coherence: 5,
        engagement: 4,
        hookStrength: 4,
        outlineCoverage: 5,
        sourceFidelity: null,
        styleMatch: 5,
        issues: []
      }; } }, workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({
      kind: "reviewed",
      revision: { snapshot: { styleProfile: { preset: "knowledge_cards", customInstructions: "一句一条" } } }
    });
  });
});
