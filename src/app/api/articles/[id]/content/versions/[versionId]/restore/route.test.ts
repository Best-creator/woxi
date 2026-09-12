// @vitest-environment node

import { describe, expect, it } from "vitest";
import { requestJson } from "../../../../../../../../../tests/helpers/request";
import { articleWithGeneratedContent } from "../../../../../../../../../tests/helpers/content-fixture";
import { createContentRestoreRouteHandler } from "./route";

describe("content restore route", () => {
  const context = (id: string, versionId: string) => ({ params: Promise.resolve({ id, versionId }) });

  it("restores a previous version as a new one", async () => {
    const fixture = await articleWithGeneratedContent();
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: "改过的正文", version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");
    const handler = createContentRestoreRouteHandler({ workflow: fixture.contentWorkflow });

    const restored = await handler(
      requestJson("http://test/content/restore", { expectedUpdatedAt: saved.updatedAt }),
      context(saved.id, fixture.contentRevision.id)
    );

    expect(restored.status).toBe(200);
    expect((await restored.json()).revision).toMatchObject({ scope: "content", version: 2, reason: "restored" });
  });

  it("maps unknown versions to 404 and stale writes to 409", async () => {
    const fixture = await articleWithGeneratedContent();
    const handler = createContentRestoreRouteHandler({ workflow: fixture.contentWorkflow });

    const missing = await handler(
      requestJson("http://test/content/restore", { expectedUpdatedAt: fixture.article.updatedAt }),
      context(fixture.article.id, "missing")
    );
    const stale = await handler(
      requestJson("http://test/content/restore", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      context(fixture.article.id, fixture.contentRevision.id)
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
  });
});
