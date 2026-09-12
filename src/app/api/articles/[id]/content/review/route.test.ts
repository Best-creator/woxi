// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentReviewer } from "@/features/content/demo-content-agents";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../tests/helpers/content-fixture";
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
});
