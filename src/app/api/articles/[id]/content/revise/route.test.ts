// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoStoryboardDesigner } from "@/features/content/demo-storyboard-designer";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { reviewContent } from "@/features/content/review-content";
import type { ContentReviewer } from "@/features/content/ports";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../tests/helpers/content-fixture";
import { createContentReviseRouteHandler } from "./route";

describe("content revise route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  const handlerWith = (fixture: Awaited<ReturnType<typeof articleWithGeneratedContent>>) =>
    createContentReviseRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      designer: new DemoStoryboardDesigner(),
      workflow: fixture.contentWorkflow,
      images: fixture.imageAssets
    });

  it("maps a missing review to 400 and revises with personal instructions", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = handlerWith(fixture);

    const noReview = await handler(
      requestJson("http://test/content/revise", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      }),
      context(fixture.article.id)
    );
    expect(noReview.status).toBe(400);
    expect(((await noReview.json()) as { error: string }).error).toContain("审核");

    const revised = await handler(
      requestJson("http://test/content/revise", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher"),
        userInstructions: "把第二段讲得更细"
      }),
      context(fixture.article.id)
    );
    expect(revised.status).toBe(200);
    const body = (await revised.json()) as {
      article: { status: string };
      revision: { reason: string };
      replacedSegments: number;
      retainedSegments: number;
    };
    expect(body.article.status).toBe("editing");
    expect(body.revision.reason).toBe("review_applied");
    expect(body.replacedSegments + body.retainedSegments).toBeGreaterThan(0);
  });

  it("revises by review feedback and reports replaced vs retained counts", async () => {
    const fixture = await articleWithGeneratedContent();
    const segments = fixture.article.planning.storyboardSegments ?? [];
    const flaggedCopyBlockId = segments[0]!.copyBlockIds[1]!;
    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        reviewer: {
          review: async () => ({
            status: "needs_revision",
            summary: "该段过于单薄",
            clarity: 3,
            beginnerFriendliness: 3,
            coherence: 4,
            engagement: 3,
            outlineCoverage: 4,
            sourceFidelity: null,
            styleMatch: 3,
            issues: [
              { blockIds: [flaggedCopyBlockId], severity: "warning", message: "未展开场景描绘" }
            ]
          })
        } as unknown as ContentReviewer,
        workflow: fixture.contentWorkflow
      }
    );
    const handler = handlerWith(fixture);

    const response = await handler(
      requestJson("http://test/content/revise", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      revision: { reason: string };
      replacedSegments: number;
      retainedSegments: number;
    };
    // Demo 修订器只改被点名段：恰好替换 1 段、保留其余。
    expect(body.replacedSegments).toBe(1);
    expect(body.retainedSegments).toBe(segments.length - 1);
    expect(body.revision.reason).toBe("review_applied");
  });

  it("rejects an invalid body before touching the article", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = handlerWith(fixture);

    const response = await handler(
      requestJson("http://test/content/revise", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(400);
    expect((await fixture.articles.findById(fixture.article.id))?.planning.storyboardSegments).toBeTruthy();
  });
});
