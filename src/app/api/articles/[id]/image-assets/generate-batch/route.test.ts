// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import type { GeneratedImagePayload, ImageGenerator } from "@/features/images/image-generator";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createImageAssetBatchRouteHandler } from "./route";

const suggestion: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "封面",
  prompt: "信息图",
  altText: "复利封面",
  aspectRatio: "cover"
};

function generatorReturning(payload: GeneratedImagePayload | Error): ImageGenerator {
  return {
    generate: () => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))
  };
}

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const created = await articles.create({ topic: "复利" });
  const planned = await images.applyPlan(created.id, created.updatedAt, [suggestion]);
  if (planned.kind !== "saved") throw new Error("fixture should plan");
  return { articles, images, article: planned.article };
}

describe("image asset generate-batch route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 200 with per-asset results on success", async () => {
    const { articles, images, article } = await setup();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-batch-route-"));
    const POST = createImageAssetBatchRouteHandler(
      articles,
      images,
      generatorReturning({ remoteUrl: "https://cdn.example.test/a.png", binary: Buffer.from("b"), format: "png" }),
      storageDir
    );

    const response = await POST(
      requestJson("http://test/generate-batch", { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      article: { id: string };
      assets: Array<{ status: string }>;
      results: Array<{ ok: boolean }>;
      succeeded: number;
      failed: number;
    };
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(1);
    expect(body.assets[0]?.status).toBe("generated");
  });

  it("rejects unconfigured generators with 503 and unknown articles with 404", async () => {
    const { articles, images, article } = await setup();
    const unconfigured = createImageAssetBatchRouteHandler(articles, images, null);
    expect(
      (await unconfigured(requestJson("http://test/generate-batch", { expectedUpdatedAt: article.updatedAt }), context(article.id))).status
    ).toBe(503);

    const POST = createImageAssetBatchRouteHandler(
      articles,
      images,
      generatorReturning({ remoteUrl: null, binary: Buffer.from("b"), format: "png" })
    );
    expect(
      (await POST(requestJson("http://test/generate-batch", { expectedUpdatedAt: article.updatedAt }), context("no-such-article"))).status
    ).toBe(404);
  });

  it("maps stale versions, invalid bodies and nothing-pending to 409/400", async () => {
    const { articles, images, article } = await setup();
    const POST = createImageAssetBatchRouteHandler(
      articles,
      images,
      generatorReturning({ remoteUrl: null, binary: Buffer.from("b"), format: "png" })
    );

    const stale = await POST(
      requestJson("http://test/generate-batch", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      context(article.id)
    );
    expect(stale.status).toBe(409);

    const invalidBody = await POST(
      requestJson("http://test/generate-batch", { expectedUpdatedAt: "not-a-date" }),
      context(article.id)
    );
    expect(invalidBody.status).toBe(400);

    // 先成功一批，再打一次：没有待生成的配图 → 400。
    const ok = await POST(
      requestJson("http://test/generate-batch", { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { article: { updatedAt: string } };
    const second = await POST(
      requestJson("http://test/generate-batch", { expectedUpdatedAt: okBody.article.updatedAt }),
      context(article.id)
    );
    expect(second.status).toBe(400);
  });
});
