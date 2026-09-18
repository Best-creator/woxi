// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import type { GeneratedImagePayload, ImageGenerator } from "@/features/images/image-generator";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { createTestDatabase } from "../../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../../tests/helpers/request";
import { createImageAssetGenerateRouteHandler } from "./route";

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
  return { articles, images, article: planned.article, assetId: planned.assets[0]!.id };
}

describe("image asset generate route", () => {
  const context = (id: string, assetId: string) => ({
    params: Promise.resolve({ id, assetId })
  });

  it("returns 200 with article and assets on success", async () => {
    const { articles, images, article, assetId } = await setup();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-route-"));
    const POST = createImageAssetGenerateRouteHandler(
      articles,
      images,
      generatorReturning({ remoteUrl: "https://cdn.example.test/a.png", binary: Buffer.from("b"), format: "png" }),
      storageDir
    );

    const response = await POST(
      requestJson(`http://test/generate`, { expectedUpdatedAt: article.updatedAt }),
      context(article.id, assetId)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets: Array<{ status: string; publicUrl: string }> };
    expect(body.assets[0]?.status).toBe("generated");
    expect(body.assets[0]?.publicUrl).toBe("https://cdn.example.test/a.png");
  });

  it("rejects unconfigured generators with 503", async () => {
    const { articles, images, article, assetId } = await setup();
    const POST = createImageAssetGenerateRouteHandler(articles, images, null);

    const response = await POST(
      requestJson("http://test/generate", { expectedUpdatedAt: article.updatedAt }),
      context(article.id, assetId)
    );

    expect(response.status).toBe(503);
  });

  it("maps missing assets, stale versions and generator failures to their statuses", async () => {
    const { articles, images, article, assetId } = await setup();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-route-"));
    const failing = generatorReturning(new Error("boom"));

    const missing = await createImageAssetGenerateRouteHandler(articles, images, failing, storageDir)(
      requestJson("http://test/generate", { expectedUpdatedAt: article.updatedAt }),
      context(article.id, "no-such-asset")
    );
    const stale = await createImageAssetGenerateRouteHandler(articles, images, failing, storageDir)(
      requestJson("http://test/generate", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      context(article.id, assetId)
    );
    const failed = await createImageAssetGenerateRouteHandler(articles, images, failing, storageDir)(
      requestJson("http://test/generate", { expectedUpdatedAt: article.updatedAt }),
      context(article.id, assetId)
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(failed.status).toBe(502);
    // 失败响应必须带回服务端已落库的最新文章与资产：前端回灌后重试的令牌才有效。
    const failedBody = (await failed.json()) as {
      error: string;
      article?: { updatedAt: string };
      assets?: Array<{ id: string; status: string }>;
    };
    expect(failedBody.error).toBeTruthy();
    expect(failedBody.article?.updatedAt).not.toBe(article.updatedAt);
    expect(failedBody.assets?.find((asset) => asset.id === assetId)?.status).toBe("failed");
    // 失败后资产应停留在 failed 状态（可重试），而不是留在 generating。
    const afterFailure = await images.findById(article.id, assetId);
    expect(afterFailure?.status).toBe("failed");
  });

  it("maps invalid JSON and bodies to 400", async () => {
    const { articles, images, article, assetId } = await setup();
    const POST = createImageAssetGenerateRouteHandler(
      articles,
      images,
      generatorReturning({ remoteUrl: null, binary: null, format: "png" })
    );
    const badJson = await POST(
      new Request("http://test/generate", { method: "POST", body: "{" }),
      context(article.id, assetId)
    );
    const invalidBody = await POST(
      requestJson("http://test/generate", { expectedUpdatedAt: "not-a-date" }),
      context(article.id, assetId)
    );

    expect(badJson.status).toBe(400);
    expect(invalidBody.status).toBe(400);
  });
});
