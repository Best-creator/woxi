// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator } from "@/features/outlines/demo-outline-agents";
import { generateOutline } from "@/features/outlines/generate-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createOutlineVersionsRouteHandlers } from "./route";
import { createOutlineRestoreRouteHandler } from "./[versionId]/restore/route";

describe("outline versions routes", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const restoreContext = (id: string, versionId: string) => ({ params: Promise.resolve({ id, versionId }) });

  it("lists, manually saves, and restores versions", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const generated = await generateOutline({ articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const handlers = createOutlineVersionsRouteHandlers({ articles, sources, workflow });
    const versions = await handlers.GET(new Request("http://test/outline/versions"), context(created.id));
    const manual = await handlers.POST(requestJson("http://test/outline/versions", { expectedUpdatedAt: generated.article.updatedAt }), context(created.id));
    const restored = await createOutlineRestoreRouteHandler(workflow)(
      requestJson("http://test/outline/restore", { expectedUpdatedAt: generated.article.updatedAt }),
      restoreContext(created.id, generated.revision.id)
    );

    expect(versions.status).toBe(200);
    expect((await versions.json()).versions).toHaveLength(1);
    expect(manual.status).toBe(200);
    expect(restored.status).toBe(200);
    expect((await restored.json()).revision).toMatchObject({ reason: "restored", version: 2 });
  });

  it("returns 404 for a missing article and 409 for a stale manual save", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const handlers = createOutlineVersionsRouteHandlers({ articles, sources, workflow });
    const missing = await handlers.GET(new Request("http://test/outline/versions"), context("missing"));
    const stale = await handlers.POST(requestJson("http://test/outline/versions", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }), context(article.id));

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
  });
});
