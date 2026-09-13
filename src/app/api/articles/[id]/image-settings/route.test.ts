// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImagePlanSettingsRepository } from "@/features/images/plan-settings";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { createImageSettingsRouteHandler } from "./route";

describe("image settings route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  async function setup() {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const created = await articles.create({ topic: "复利" });
    const settings = new SqliteImagePlanSettingsRepository(db);
    return { articles, settings, article: created };
  }

  it("returns defaults and round-trips saved preferences", async () => {
    const { articles, settings, article } = await setup();
    const handler = createImageSettingsRouteHandler(articles, settings);

    const initial = await handler.GET(new Request("http://test"), context(article.id));
    expect(await initial.json()).toEqual({ style: "", characterId: null });

    const saved = await handler.PUT(
      new Request("http://test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "简笔画", characterId: "char-1" })
      }),
      context(article.id)
    );
    expect(await saved.json()).toEqual({ style: "简笔画", characterId: "char-1" });

    const reloaded = await createImageSettingsRouteHandler(articles, settings)
      .GET(new Request("http://test"), context(article.id));
    expect(await reloaded.json()).toEqual({ style: "简笔画", characterId: "char-1" });
  });

  it("rejects invalid payloads and missing articles", async () => {
    const { articles, settings, article } = await setup();
    const handler = createImageSettingsRouteHandler(articles, settings);

    const invalid = await handler.PUT(
      new Request("http://test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "x".repeat(300) })
      }),
      context(article.id)
    );
    const missing = await handler.GET(new Request("http://test"), context("missing"));

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
