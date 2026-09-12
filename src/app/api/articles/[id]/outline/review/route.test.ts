// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { generateOutline } from "@/features/outlines/generate-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createOutlineReviewRouteHandler } from "./route";

describe("outline review route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("reviews a generated outline and maps missing outline to 400", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const sources = new SqliteSourceRepository(db);
    const workflow = new SqliteOutlineWorkflowRepository(db);
    const created = await articles.create({ topic: "机会成本" });
    const handler = createOutlineReviewRouteHandler({ articles, sources, reviewer: new DemoOutlineReviewer(), workflow });
    const noOutline = await handler(requestJson("http://test/outline/review", { expectedUpdatedAt: created.updatedAt }), context(created.id));
    const generated = await generateOutline({ articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" }, { articles, sources, generator: new DemoOutlineGenerator(), workflow });
    if (generated.kind !== "generated") throw new Error("fixture should generate");
    const reviewed = await handler(requestJson("http://test/outline/review", { expectedUpdatedAt: generated.article.updatedAt }), context(created.id));

    expect(noOutline.status).toBe(400);
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).review).toMatchObject({ result: { status: "passed" } });
  });
});
