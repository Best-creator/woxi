// @vitest-environment node

import { describe, expect, it } from "vitest";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../tests/helpers/content-fixture";
import { createContentVersionsRouteHandlers } from "./route";

describe("content versions route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("lists content versions and appends a manual version after an edit", async () => {
    const fixture = await articleWithGeneratedContent();
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: `${block.content} 手工改过`, version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");
    const handlers = createContentVersionsRouteHandlers({
      articles: fixture.articles,
      sources: fixture.sources,
      workflow: fixture.contentWorkflow,
      defaultModel: "writer-large"
    });

    const listed = await handlers.GET(
      new Request(`http://test/api/articles/${saved.id}/content/versions`),
      context(saved.id)
    );
    const version = await handlers.POST(
      requestJson("http://test/content/versions", { expectedUpdatedAt: saved.updatedAt }),
      context(saved.id)
    );

    expect(listed.status).toBe(200);
    expect((await listed.json()).versions).toHaveLength(1);
    expect(version.status).toBe(200);
    expect((await version.json()).revision).toMatchObject({
      scope: "content",
      version: 2,
      reason: "manual",
      model: "writer-large"
    });
  });

  it("returns 404 for an unknown article", async () => {
    const fixture = await articleWithGeneratedContent();
    const handlers = createContentVersionsRouteHandlers({
      articles: fixture.articles,
      sources: fixture.sources,
      workflow: fixture.contentWorkflow
    });

    const response = await handlers.GET(
      new Request("http://test/api/articles/missing/content/versions"),
      context("missing")
    );

    expect(response.status).toBe(404);
  });
});
