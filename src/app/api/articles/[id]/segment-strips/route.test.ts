// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../tests/helpers/request";
import { createSegmentStripsComposeHandler } from "./route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("segment strips route", () => {
  it("maps invalid JSON, invalid body, missing article, stale tokens and missing design to HTTP statuses", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const images = new SqliteImageAssetRepository(db);
    const created = await articles.create({ topic: "护眼" });
    const POST = createSegmentStripsComposeHandler(articles, images);

    const invalidJson = await POST(
      new Request("http://test/segment-strips", { method: "POST", body: "{" }),
      context(created.id)
    );
    const invalidBody = await POST(
      requestJson(`http://test/api/articles/${created.id}/segment-strips`, {
        expectedUpdatedAt: "not-a-date"
      }),
      context(created.id)
    );
    const missing = await POST(
      requestJson("http://test/segment-strips", { expectedUpdatedAt: created.updatedAt }),
      context("missing")
    );
    const stale = await POST(
      requestJson(`http://test/api/articles/${created.id}/segment-strips`, {
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z"
      }),
      context(created.id)
    );
    const noDesign = await POST(
      requestJson(`http://test/api/articles/${created.id}/segment-strips`, {
        expectedUpdatedAt: created.updatedAt
      }),
      context(created.id)
    );

    expect(invalidJson.status).toBe(400);
    expect(invalidBody.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(noDesign.status).toBe(400);
    if (noDesign.status === 400) {
      const payload = (await noDesign.json()) as { error?: string };
      expect(payload.error).toContain("分镜设计");
    }
  });
});
