// @vitest-environment node

import { describe, expect, it } from "vitest";
import { contentReviewIsStale, type ContentWorkspaceReview } from "@/app/articles/[id]/content-state";
import { DemoContentReviewer } from "@/features/content/demo-content-agents";
import { DemoStoryboardDesigner } from "@/features/content/demo-storyboard-designer";
import { requestJson } from "../../../../../../../tests/helpers/request";
import {
  articleWithConfirmedOutline,
  articleWithGeneratedContent
} from "../../../../../../../tests/helpers/content-fixture";
import { createContentGenerateRouteHandler } from "../generate/route";
import { createContentReviewRouteHandler } from "./route";

describe("content review route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("reviews the current draft and maps a stale outline to 400", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = createContentReviewRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      reviewer: new DemoContentReviewer(),
      workflow: fixture.contentWorkflow
    });

    const reviewed = await handler(
      requestJson("http://test/content/review", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id)
    );

    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).review).toMatchObject({ result: { status: "passed" } });

    const stale = {
      ...fixture.article,
      planning: { ...fixture.article.planning, confirmedOutlineRevisionId: "outline-v9" }
    };
    await fixture.articles.save(stale, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");

    const rejected = await handler(
      requestJson("http://test/content/review", { expectedUpdatedAt: saved.updatedAt }),
      context(saved.id)
    );

    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("旧大纲");
  });

  it("keeps a fresh review after storyboard design despite key-order normalization", async () => {
    // 回归：分镜设计走两段式写入后，最终文章从库里重新解析（styleProfile 键序被
    // parseStyleProfileJson 归一化），审核快照里仍是路由 Zod 解析的原始键序。
    // 审核过期判定必须键序不敏感，否则刚审完就被误标「审核已过期」。
    const fixture = await articleWithConfirmedOutline();
    const generateRoute = createContentGenerateRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      designer: new DemoStoryboardDesigner(),
      workflow: fixture.contentWorkflow,
      images: fixture.imageAssets
    });
    const reviewRoute = createContentReviewRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      reviewer: new DemoContentReviewer(),
      workflow: fixture.contentWorkflow
    });

    const generateResponse = await generateRoute(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: { preset: "knowledge_cards" }
      }),
      context(fixture.article.id)
    );
    expect(generateResponse.status).toBe(200);
    const generated = JSON.parse(JSON.stringify(await generateResponse.json())) as {
      article: NonNullable<Awaited<ReturnType<typeof fixture.articles.findById>>>;
    };

    const reviewResponse = await reviewRoute(
      requestJson("http://test/content/review", {
        expectedUpdatedAt: generated.article.updatedAt
      }),
      context(fixture.article.id)
    );
    expect(reviewResponse.status).toBe(200);
    const reviewed = JSON.parse(
      JSON.stringify(await reviewResponse.json())
    ) as ContentWorkspaceReview;

    expect(contentReviewIsStale(generated.article, [], reviewed)).toBe(false);
  });
});
