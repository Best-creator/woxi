// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { createImageAssetListRouteHandler } from "./route";

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

describe("image asset list route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns only assets belonging to the requested article", async () => {
    const { articles, images, first, second } = await setup();
    const GET = createImageAssetListRouteHandler(articles, images);

    const response = await GET(new Request("http://test/image-assets"), context(first.article.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assets: first.assets });
    expect(first.assets[0]?.id).not.toBe(second.assets[0]?.id);
  });

  it("returns 404 before listing assets for a missing article", async () => {
    const { articles, images } = await setup();
    const GET = createImageAssetListRouteHandler(articles, images);

    const response = await GET(new Request("http://test/image-assets"), context("missing"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "文章不存在" });
  });
});
