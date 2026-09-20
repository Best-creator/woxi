// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoStoryboardDesigner } from "@/features/content/demo-storyboard-designer";
import type { GenerateContentInput, ReviseStoryboardDesignInput } from "@/features/content/ports";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { requestJson } from "../../../../../../../tests/helpers/request";
import { articleWithConfirmedOutline } from "../../../../../../../tests/helpers/content-fixture";
import { createContentGenerateRouteHandler } from "./route";

describe("content generate route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  const handlerWith = (fixture: Awaited<ReturnType<typeof articleWithConfirmedOutline>>) =>
    createContentGenerateRouteHandler({
      articles: fixture.articles,
      sources: fixture.sources,
      designer: new DemoStoryboardDesigner(),
      workflow: fixture.contentWorkflow,
      images: fixture.imageAssets
    });

  it("designs storyboard segments and maps an unconfirmed outline to 400", async () => {
    const fixture = await articleWithConfirmedOutline();
    const draft = await fixture.articles.create({ topic: "沉没成本" });
    const handler = handlerWith(fixture);
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
    const body = await generated.json() as {
      article: { status: string; planning: { storyboardSegments: unknown[] } };
      revision: { scope: string };
    };
    expect(body.article.status).toBe("editing");
    expect(body.article.planning.storyboardSegments.length).toBeGreaterThan(0);
    expect(body.revision.scope).toBe("content");
  });

  it("accepts a bare preset and fills in the derived style fields", async () => {
    const fixture = await articleWithConfirmedOutline();
    const handler = handlerWith(fixture);

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

  it("forwards drawing style and character into the design request", async () => {
    const fixture = await articleWithConfirmedOutline();
    const handler = handlerWith(fixture);

    const response = await handler(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher"),
        drawingStyle: "水墨漫画风",
        character: { name: "小知", persona: "科普讲解员", description: "圆框眼镜" }
      }),
      context(fixture.article.id)
    );

    expect(response.status).toBe(200);
    const segments = ((await response.json()) as {
      article: { planning: { storyboardSegments: { frameAssetIds: string[] }[] } };
    }).article.planning.storyboardSegments;
    for (const segment of segments) {
      expect(segment.frameAssetIds.length).toBeGreaterThan(0);
    }
  });

  it("没传 drawingStyle 时按文章配图偏好兜底，显式传入时以客户端为准", async () => {
    // 帧提示词一旦在设计阶段写死自己的画风（默认「日系动漫画风、赛璐璐上色」），
    // 生图阶段前置的画风就会和它打架——所以设计阶段必须拿到同一份画风。
    const captured: Array<string | undefined> = [];
    const captureDesigner = () => {
      const demo = new DemoStoryboardDesigner();
      return {
        design: async (input: GenerateContentInput) => {
          captured.push(input.drawingStyle);
          return await demo.design(input);
        },
        revise: (input: ReviseStoryboardDesignInput) => demo.revise(input)
      };
    };
    const styleProfile = resolveStyleProfile("popular_science_teacher");

    const fromSettings = await articleWithConfirmedOutline();
    const settingsHandler = createContentGenerateRouteHandler({
      articles: fromSettings.articles,
      sources: fromSettings.sources,
      designer: captureDesigner(),
      workflow: fromSettings.contentWorkflow,
      images: fromSettings.imageAssets,
      resolveDrawingStyle: async () => "【画风】白底粗线手绘知识条漫"
    });
    const settingsResponse = await settingsHandler(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: fromSettings.article.updatedAt,
        styleProfile
      }),
      context(fromSettings.article.id)
    );

    const explicit = await articleWithConfirmedOutline();
    const explicitHandler = createContentGenerateRouteHandler({
      articles: explicit.articles,
      sources: explicit.sources,
      designer: captureDesigner(),
      workflow: explicit.contentWorkflow,
      images: explicit.imageAssets,
      resolveDrawingStyle: async () => {
        throw new Error("显式传了 drawingStyle 就不该再去读配图偏好");
      }
    });
    const explicitResponse = await explicitHandler(
      requestJson("http://test/content/generate", {
        expectedUpdatedAt: explicit.article.updatedAt,
        styleProfile,
        drawingStyle: "水墨漫画风"
      }),
      context(explicit.article.id)
    );

    expect(settingsResponse.status).toBe(200);
    expect(explicitResponse.status).toBe(200);
    expect(captured).toEqual(["【画风】白底粗线手绘知识条漫", "水墨漫画风"]);
  });

  it("rejects an invalid style profile before touching the article", async () => {
    const fixture = await articleWithConfirmedOutline();
    const handler = handlerWith(fixture);

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
