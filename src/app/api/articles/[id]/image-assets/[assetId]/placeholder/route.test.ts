// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { createTestDatabase } from "../../../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../../../tests/helpers/request";
import { createImageAssetPlaceholderRouteHandler } from "./route";

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
  const article = await articles.create({ topic: "复利" });
  const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
  if (planned.kind !== "saved") throw new Error("fixture should create an asset");
  const asset = planned.assets[0];
  if (!asset) throw new Error("fixture should include an asset");
  return { articles, images, article: planned.article, asset };
}

describe("image asset placeholder route", () => {
  const context = (id: string, assetId: string) => ({ params: Promise.resolve({ id, assetId }) });

  it("refreshes an enabled asset without any external image request", async () => {
    const { articles, images, article, asset } = await setup();
    const POST = createImageAssetPlaceholderRouteHandler(articles, images);

    const response = await POST(
      requestJson("http://test/placeholder", { expectedUpdatedAt: article.updatedAt }),
      context(article.id, asset.id)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.article.updatedAt).not.toBe(article.updatedAt);
    expect(body.assets[0]).toMatchObject({ id: asset.id, status: "placeholder" });
  });

  it("rejects disabled assets and maps missing and stale requests", async () => {
    const { articles, images, article, asset } = await setup();
    const disabled = await images.update(article.id, asset.id, article.updatedAt, { enabled: false });
    if (disabled.kind !== "saved") throw new Error("fixture should disable asset");
    const POST = createImageAssetPlaceholderRouteHandler(articles, images);
    const disabledResponse = await POST(
      requestJson("http://test/placeholder", { expectedUpdatedAt: disabled.article.updatedAt }),
      context(article.id, asset.id)
    );
    const missing = await POST(
      requestJson("http://test/placeholder", { expectedUpdatedAt: disabled.article.updatedAt }),
      context(article.id, "missing")
    );
    const stale = await POST(
      requestJson("http://test/placeholder", { expectedUpdatedAt: article.updatedAt }),
      context(article.id, asset.id)
    );

    expect(disabledResponse.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
  });
});
