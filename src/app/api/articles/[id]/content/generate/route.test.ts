// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentGenerator } from "@/features/content/demo-content-agents";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithConfirmedOutline } from "../../../../../../../tests/helpers/content-fixture";
import { createContentGenerateRouteHandler } from "./route";

describe("content generate route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("generates a full article and maps an unconfirmed outline to 400", async () => {
    const fixture = await articleWithConfirmedOutline();
    const draft = await fixture.articles.create({ topic: "沉没成本" });
    const handler = createContentGenerateRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      generator: new DemoContentGenerator(),
      workflow: fixture.contentWorkflow
    });
    const styleProfile = resolveStyleProfile("friend_chat");
    const notReady = await handler(
      requestJson("http://test/content/generate", { expectedUpdatedAt: draft.updatedAt, styleProfile }),
      context(draft.id)
    );
    const generated = await handler(
      requestJson("http://test/content/generate", { expectedUpdatedAt: fixture.article.updatedAt, styleProfile }),
      context(fixture.article.id)
    );

    expect(notReady.status).toBe(400);
    expect(generated.status).toBe(200);
    const body = await generated.json() as { article: { status: string }; revision: { scope: string } };
    expect(body.article.status).toBe("editing");
    expect(body.revision.scope).toBe("content");
  });

  it("accepts a bare preset and fills in the derived style fields", async () => {
    const fixture = await articleWithConfirmedOutline();
    const handler = createContentGenerateRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      generator: new DemoContentGenerator(),
      workflow: fixture.contentWorkflow
    });

    const response = await handler(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: { preset: "knowledge_cards", customInstructions: "一句一条" }
      }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      article: { styleProfile: { preset: string; customInstructions: string; tone: string } };
    };
    expect(body.article.styleProfile.preset).toBe("knowledge_cards");
    expect(body.article.styleProfile.customInstructions).toBe("一句一条");
    expect(body.article.styleProfile.tone).toBe(resolveStyleProfile("knowledge_cards").tone);
  });

  it("rejects an invalid style profile before touching the article", async () => {
    const fixture = await articleWithConfirmedOutline();
    const handler = createContentGenerateRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      generator: new DemoContentGenerator(),
      workflow: fixture.contentWorkflow
    });

    const response = await handler(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: { preset: "nope" }
      }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(400);
    expect((await fixture.articles.findById(fixture.article.id))?.blocks).toEqual([]);
  });
});
