// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { createCoverRouteHandler } from "./route";

async function setup() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  return { articles, images, article };
}

describe("cover slot route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (body: unknown) =>
    new Request("http://test/cover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

  it("creates the cover slot once and reports the created asset", async () => {
    const { images, article } = await setup();
    const POST = createCoverRouteHandler(images);

    const response = await POST(
      request({ expectedUpdatedAt: article.updatedAt, prompt: "封面提示词", aspectRatio: "square" }),
      context(article.id)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      article: { id: string; updatedAt: string };
      assets: Array<{ id: string; type: string }>;
      asset: { id: string; type: string; aspectRatio: string; anchorBlockId: null };
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.article.id).toBe(article.id);
    expect(body.asset.type).toBe("cover");
    expect(body.asset.aspectRatio).toBe("square");
    expect(body.asset.anchorBlockId).toBeNull();
    expect(body.assets.filter((asset) => asset.type === "cover")).toHaveLength(1);

    // 第二次同样的请求是幂等的：不新建、也不改作者写过的提示词。
    const again = await POST(
      request({ expectedUpdatedAt: body.article.updatedAt, prompt: "不该覆盖" }),
      context(article.id)
    );
    expect(again.status).toBe(200);
    const repeat = (await again.json()) as {
      asset: { id: string; prompt: string };
      created: boolean;
      assets: unknown[];
    };
    expect(repeat.created).toBe(false);
    expect(repeat.asset.id).toBe(body.asset.id);
    expect(repeat.asset.prompt).toBe("封面提示词");
    expect(repeat.assets).toHaveLength(body.assets.length);
  });

  it("rejects a body without a version token", async () => {
    const { images, article } = await setup();
    const POST = createCoverRouteHandler(images);

    const response = await POST(request({ prompt: "只有提示词" }), context(article.id));

    expect(response.status).toBe(400);
  });

  it("maps a stale version to 409 and a missing article to 404", async () => {
    const { images, article } = await setup();
    const POST = createCoverRouteHandler(images);

    const stale = await POST(
      request({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      context(article.id)
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("文章已在其他位置更新");

    const missing = await POST(request({ expectedUpdatedAt: article.updatedAt }), context("missing"));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("文章不存在");
  });
});
