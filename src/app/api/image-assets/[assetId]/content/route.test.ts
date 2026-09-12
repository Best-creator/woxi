// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { createImageAssetContentRouteHandler } from "./route";

const suggestion: ImagePlanSuggestion = {
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
  const planned = await images.applyPlan(article.id, article.updatedAt, [suggestion]);
  if (planned.kind !== "saved") throw new Error("fixture should plan");
  const asset = planned.assets[0];
  if (!asset) throw new Error("asset should exist");
  return { db, images, article: planned.article, asset };
}

describe("image asset content route", () => {
  const context = (assetId: string) => ({ params: Promise.resolve({ assetId }) });

  it("returns a secured SVG response for placeholder assets", async () => {
    const { images, asset } = await setup();
    const response = await createImageAssetContentRouteHandler(images)(
      new Request(`http://test/api/image-assets/${asset.id}/content`),
      context(asset.id)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("待生成");
  });

  it("does not expose missing or disabled assets", async () => {
    const { images, article, asset } = await setup();
    const disabled = await images.update(article.id, asset.id, article.updatedAt, { enabled: false });
    if (disabled.kind !== "saved") throw new Error("fixture should disable");
    const GET = createImageAssetContentRouteHandler(images);

    expect((await GET(new Request("http://test/content"), context("missing"))).status).toBe(404);
    expect((await GET(new Request("http://test/content"), context(asset.id))).status).toBe(404);
  });

  it("returns 404 for generated assets without a usable file reference", async () => {
    const { db, images, asset } = await setup();
    db.prepare("UPDATE image_assets SET status = 'generated', file_path = NULL, public_url = NULL WHERE id = ?").run(asset.id);

    const response = await createImageAssetContentRouteHandler(images)(
      new Request("http://test/content"),
      context(asset.id)
    );

    expect(response.status).toBe(404);
  });
});
