// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { createTestDatabase } from "../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { createImageAssetRouteHandlers } from "./route";

const cover: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "封面",
  prompt: "信息图",
  altText: "复利封面",
  aspectRatio: "cover"
};

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const first = await articles.create({ topic: "复利" });
  const second = await articles.create({ topic: "机会成本" });
  const firstPlan = await images.applyPlan(first.id, first.updatedAt, [cover]);
  const secondPlan = await images.applyPlan(second.id, second.updatedAt, [cover]);
  if (firstPlan.kind !== "saved" || secondPlan.kind !== "saved") {
    throw new Error("fixture should create image assets");
  }
  return { articles, images, first: firstPlan, second: secondPlan };
}

describe("image asset mutation route", () => {
  const context = (id: string, assetId: string) => ({ params: Promise.resolve({ id, assetId }) });

  it("updates an asset and returns the synchronized article and assets", async () => {
    const { articles, images, first } = await setup();
    const asset = first.assets[0];
    if (!asset) throw new Error("fixture should include an asset");
    const PATCH = createImageAssetRouteHandlers(articles, images).PATCH;

    const response = await PATCH(
      requestJson("http://test/image-assets", {
        expectedUpdatedAt: first.article.updatedAt,
        prompt: "一张更清晰的信息图",
        enabled: false
      }, "PATCH"),
      context(first.article.id, asset.id)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.article.updatedAt).not.toBe(first.article.updatedAt);
    expect(body.assets[0]).toMatchObject({
      id: asset.id,
      prompt: "一张更清晰的信息图",
      status: "disabled",
      manuallyEdited: true
    });
  });

  it("rejects malformed JSON and patches without a mutable field", async () => {
    const { articles, images, first } = await setup();
    const asset = first.assets[0];
    if (!asset) throw new Error("fixture should include an asset");
    const PATCH = createImageAssetRouteHandlers(articles, images).PATCH;
    const invalidJson = await PATCH(
      new Request("http://test/image-assets", { method: "PATCH", body: "{" }),
      context(first.article.id, asset.id)
    );
    const emptyPatch = await PATCH(
      requestJson("http://test/image-assets", { expectedUpdatedAt: first.article.updatedAt }, "PATCH"),
      context(first.article.id, asset.id)
    );

    expect(invalidJson.status).toBe(400);
    expect(emptyPatch.status).toBe(400);
  });

  it("keeps cross-article, stale, and invalid anchor mutations out of the repository state", async () => {
    const { articles, images, first, second } = await setup();
    const firstAsset = first.assets[0];
    const secondAsset = second.assets[0];
    if (!firstAsset || !secondAsset) throw new Error("fixture should include assets");
    const PATCH = createImageAssetRouteHandlers(articles, images).PATCH;
    const crossArticle = await PATCH(
      requestJson("http://test/image-assets", { expectedUpdatedAt: first.article.updatedAt, prompt: "不应修改" }, "PATCH"),
      context(first.article.id, secondAsset.id)
    );
    const stale = await PATCH(
      requestJson("http://test/image-assets", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z", prompt: "过期" }, "PATCH"),
      context(first.article.id, firstAsset.id)
    );
    const invalidAnchor = await PATCH(
      requestJson("http://test/image-assets", {
        expectedUpdatedAt: first.article.updatedAt,
        anchorBlockId: "missing-anchor"
      }, "PATCH"),
      context(first.article.id, firstAsset.id)
    );

    expect(crossArticle.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(invalidAnchor.status).toBe(400);
    expect((await images.findById(second.article.id, secondAsset.id))?.prompt).toBe("信息图");
  });

  it("removes an asset and returns its updated aggregate", async () => {
    const { articles, images, first } = await setup();
    const asset = first.assets[0];
    if (!asset) throw new Error("fixture should include an asset");
    const DELETE = createImageAssetRouteHandlers(articles, images).DELETE;

    const response = await DELETE(
      new Request("http://test/image-assets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: first.article.updatedAt })
      }),
      context(first.article.id, asset.id)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assets: [], article: { blocks: [] } });
  });

  it("maps missing and stale delete operations to 404 and 409", async () => {
    const { articles, images, first } = await setup();
    const asset = first.assets[0];
    if (!asset) throw new Error("fixture should include an asset");
    const DELETE = createImageAssetRouteHandlers(articles, images).DELETE;
    const missing = await DELETE(
      new Request("http://test/image-assets", { method: "DELETE", body: JSON.stringify({ expectedUpdatedAt: first.article.updatedAt }) }),
      context(first.article.id, "missing")
    );
    const stale = await DELETE(
      new Request("http://test/image-assets", { method: "DELETE", body: JSON.stringify({ expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }) }),
      context(first.article.id, asset.id)
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
  });
});
