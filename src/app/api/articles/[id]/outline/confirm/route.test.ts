// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { generateOutline } from "@/features/outlines/generate-outline";
import { reviewOutline } from "@/features/outlines/review-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createOutlineConfirmRouteHandler } from "./route";

describe("outline confirm route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("confirms a reviewed outline and rejects invalid request bodies", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const generated = await generateOutline({ articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    await reviewOutline({ articleId: created.id, expectedUpdatedAt: generated.article.updatedAt }, { articles, sources, reviewer: new DemoOutlineReviewer(), workflow });
    const POST = createOutlineConfirmRouteHandler({ articles, sources, workflow });
    const invalid = await POST(requestJson("http://test/outline/confirm", { expectedUpdatedAt: "no" }), context(created.id));
    const response = await POST(requestJson("http://test/outline/confirm", { expectedUpdatedAt: generated.article.updatedAt }), context(created.id));

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(200);
    expect((await response.json()).article).toMatchObject({ status: "outline_ready" });
  });
});
