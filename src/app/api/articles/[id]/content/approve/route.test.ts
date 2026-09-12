// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentReviewer } from "@/features/content/demo-content-agents";
import { reviewContent } from "@/features/content/review-content";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../tests/helpers/content-fixture";
import { createContentApproveRouteHandler } from "./route";

describe("content approve route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("requires a review first, then marks the article as content_ready", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = createContentApproveRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      workflow: fixture.contentWorkflow
    });
    const beforeReview = await handler(
      requestJson("http://test/content/approve", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id)
    );

    expect(beforeReview.status).toBe(400);

    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: new DemoContentReviewer(), workflow: fixture.contentWorkflow }
    );
    const approved = await handler(
      requestJson("http://test/content/approve", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id)
    );

    expect(approved.status).toBe(200);
    expect((await approved.json()).article.status).toBe("content_ready");
  });

  it("maps a version conflict to 409", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = createContentApproveRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      workflow: fixture.contentWorkflow
    });

    const response = await handler(
      requestJson("http://test/content/approve", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(409);
  });
});
