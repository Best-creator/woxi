// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentReviewer } from "@/features/content/demo-content-agents";
import { reviewContent } from "@/features/content/review-content";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../tests/helpers/content-fixture";
import { createContentApproveRouteHandler } from "./route";

describe("content approve route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("approves without a review, then keeps review metadata when reviewed", async () => {
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

    // 审核可选：未审核直接确认返回 200 且不携带审核结论。
    expect(beforeReview.status).toBe(200);
    const unreviewed = await beforeReview.json();
    expect(unreviewed.article.status).toBe("content_ready");
    expect(unreviewed.review).toBeNull();
  });

  it("marks a reviewed article as content_ready with its review attached", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = createContentApproveRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      workflow: fixture.contentWorkflow
    });

    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: new DemoContentReviewer(), workflow: fixture.contentWorkflow }
    );
    const approved = await handler(
      requestJson("http://test/content/approve", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id)
    );

    expect(approved.status).toBe(200);
    const result = await approved.json();
    expect(result.article.status).toBe("content_ready");
    expect(result.review).not.toBeNull();
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
