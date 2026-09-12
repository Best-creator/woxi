// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator } from "@/features/outlines/demo-outline-agents";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createOutlineGenerateRouteHandler } from "./route";

describe("outline generate route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("validates input and maps generated results", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const POST = createOutlineGenerateRouteHandler({ articles, sources, generator: new DemoOutlineGenerator(), workflow });
    const invalid = await POST(requestJson("http://test/outline/generate", {}), context(article.id));
    const response = await POST(
      requestJson("http://test/outline/generate", { expectedUpdatedAt: article.updatedAt, lengthPreset: "short" }),
      context(article.id)
    );

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(200);
    expect((await response.json()).article).toMatchObject({ status: "brief_ready" });
  });

  it("maps missing, stale, and generator failures", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const article = await articles.create({ topic: "机会成本" });
    const missing = await createOutlineGenerateRouteHandler({ articles, sources, generator: new DemoOutlineGenerator(), workflow })(
      requestJson("http://test/outline/generate", { expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" }), context("missing")
    );
    const stale = await createOutlineGenerateRouteHandler({ articles, sources, generator: new DemoOutlineGenerator(), workflow })(
      requestJson("http://test/outline/generate", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z", lengthPreset: "standard" }), context(article.id)
    );
    const failed = await createOutlineGenerateRouteHandler({ articles, sources, generator: { generate: async () => { throw new Error("upstream"); } }, workflow })(
      requestJson("http://test/outline/generate", { expectedUpdatedAt: article.updatedAt, lengthPreset: "standard" }), context(article.id)
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(failed.status).toBe(502);
  });
});
