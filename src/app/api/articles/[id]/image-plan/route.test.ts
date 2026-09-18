// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { SqliteReferenceCharacterRepository } from "@/features/characters/sqlite-repository";
import { SqliteStyleLibraryRepository } from "@/features/style-library/sqlite-repository";
import type { StyleProfile } from "@/features/style-library/domain";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { VisualPlannerError } from "@/features/images/openai-visual-planner";
import type { ImageAssetRepository } from "@/features/images/repository";
import type { VisualPlanner } from "@/features/images/visual-planner";
import { createTestDatabase } from "../../../../../../tests/helpers/test-db";
import { requestJson } from "../../../../../../tests/helpers/request";
import { createImagePlanRouteHandler } from "./route";

const suggestion: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "封面",
  prompt: "信息图",
  altText: "复利封面",
  aspectRatio: "cover"
};

const PROFILE: StyleProfile = {
  name: "Q版手绘科普",
  summary: "低饱和土黄色调的Q版手绘科普卡片画风",
  palette: ["#bfb3a2", "#8d7e6f", "#66574e"],
  lineWork: "不均匀细抖动描边，带有手绘颤动感",
  characterDesign: "两头身圆脸小动物，腮红明显",
  composition: "主体居中，顶部留出大字标题区",
  background: "米黄纸纹底，轻微颗粒质感",
  textRendering: "顶部大字标题，正文手写体配拼音格",
  promptTemplate:
    "画面采用Q版手绘科普卡片风格：低饱和土黄色调、不均匀抖动细描边、两头身圆脸角色、米黄纸纹背景，整体温暖治愈，像纸质科普卡片。"
};

function planner(run: () => Promise<ImagePlanSuggestion[]> = async () => [suggestion]): VisualPlanner {
  return { plan: async () => ({ suggestions: await run(), stripDecision: null }) };
}

async function setup(withContent = true) {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const created = await articles.create({ topic: "复利" });
  if (!withContent) return { articles, images, article: created };
  const saved = await articles.save(
    {
      ...created,
      blocks: [{ id: "block-1", type: "paragraph", content: "正文", order: 0, version: 1 }]
    },
    created.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("fixture should save");
  return { articles, images, article: saved.article };
}

describe("image plan route", () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns the saved article and assets", async () => {
    const { articles, images, article } = await setup();
    const POST = createImagePlanRouteHandler(articles, images, planner());

    const response = await POST(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).assets).toHaveLength(1);
  });

  it("maps invalid input and articles without content to 400", async () => {
    const { articles, images, article } = await setup(false);
    const POST = createImagePlanRouteHandler(articles, images, planner());
    const invalid = await POST(new Request("http://test/image-plan", { method: "POST", body: "{" }), context(article.id));
    const noContent = await POST(
      requestJson("http://test/image-plan", { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );

    expect(invalid.status).toBe(400);
    expect(noContent.status).toBe(400);
  });

  it("maps missing, stale, and planner failures to their HTTP statuses", async () => {
    const { articles, images, article } = await setup();
    const missing = await createImagePlanRouteHandler(articles, images, planner())(
      requestJson("http://test/image-plan", { expectedUpdatedAt: article.updatedAt }),
      context("missing")
    );
    const stale = await createImagePlanRouteHandler(articles, images, planner())(
      requestJson("http://test/image-plan", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
      context(article.id)
    );
    const failed = await createImagePlanRouteHandler(
      articles,
      images,
      planner(async () => { throw new VisualPlannerError("upstream", "unavailable"); })
    )(
      requestJson("http://test/image-plan", { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(failed.status).toBe(502);
  });

  it("refuses articles that already designed storyboard segments with a clear message", async () => {
    const { articles, images, article } = await setup();
    const designed = await articles.save(
      {
        ...article,
        planning: {
          ...article.planning,
          storyboardSegments: [
            {
              id: "segment-1",
              sectionKey: "section-1",
              title: "第一段",
              route: "image_text",
              copyBlockIds: ["block-1"],
              frameAssetIds: [],
              order: 0
            }
          ]
        }
      },
      article.updatedAt
    );
    if (designed.kind !== "saved") throw new Error("storyboard fixture should save");
    const POST = createImagePlanRouteHandler(articles, images, planner());

    const response = await POST(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, {
        expectedUpdatedAt: designed.article.updatedAt
      }),
      context(article.id)
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("不再重复设计分镜");
  });

  it("keeps an invalid repository plan at 400 even when its message matches a planner error", async () => {
    const { articles, images, article } = await setup();
    const collisionRepository: ImageAssetRepository = {
      list: images.list.bind(images),
      findById: images.findById.bind(images),
      findByAssetId: images.findByAssetId.bind(images),
      applyPlan: async () => ({
        kind: "invalid_plan" as const,
        message: "配图分析失败，请稍后重试"
      }),
      update: images.update.bind(images),
      ensureCover: images.ensureCover.bind(images),
      remove: images.remove.bind(images),
      refreshPlaceholder: images.refreshPlaceholder.bind(images),
      beginGeneration: images.beginGeneration.bind(images),
      completeGeneration: images.completeGeneration.bind(images),
      failGeneration: images.failGeneration.bind(images),
      listGenerations: images.listGenerations.bind(images),
      listGenerationsForAsset: images.listGenerationsForAsset.bind(images),
      findGenerationById: images.findGenerationById.bind(images),
      selectGeneration: images.selectGeneration.bind(images),
      deleteGeneration: images.deleteGeneration.bind(images),
      saveComicStrip: images.saveComicStrip.bind(images),
      saveComicStripsBatch: images.saveComicStripsBatch.bind(images),
      removeComicStrip: images.removeComicStrip.bind(images),
      applyStoryboardPlan: images.applyStoryboardPlan.bind(images),
      applyStoryboardRevision: images.applyStoryboardRevision.bind(images)
    };
    const response = await createImagePlanRouteHandler(articles, collisionRepository, planner())(
      requestJson("http://test/image-plan", { expectedUpdatedAt: article.updatedAt }),
      context(article.id)
    );

    expect(response.status).toBe(400);
  });

  it("resolves the reference character and style into planner input", async () => {
    const { articles, images, article } = await setup();
    const characters = new SqliteReferenceCharacterRepository(createTestDatabase());
    const created = await characters.create({
      name: "蘑菇老师",
      persona: "自媒体科普老师",
      description: "红伞白点的卡通蘑菇",
      mimeType: "image/png",
      filePath: "/tmp/mushroom.png"
    });
    let received: Parameters<VisualPlanner["plan"]>[0] | undefined;
    const capturingPlanner: VisualPlanner = {
      plan: async (input) => {
        received = input;
        return { suggestions: [suggestion], stripDecision: null };
      }
    };
    const capturing = createImagePlanRouteHandler(articles, images, capturingPlanner, characters);

    const response = await capturing(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, {
        expectedUpdatedAt: article.updatedAt,
        style: "简笔画",
        characterId: created.id
      }),
      context(article.id)
    );

    expect(response.status).toBe(200);
    expect(received).toMatchObject({
      style: "简笔画",
      character: { name: "蘑菇老师", persona: "自媒体科普老师", description: "红伞白点的卡通蘑菇" }
    });
  });

  it("rejects an unknown reference character with 400", async () => {
    const { articles, images, article } = await setup();
    const characters = new SqliteReferenceCharacterRepository(createTestDatabase());
    const POST = createImagePlanRouteHandler(articles, images, planner(), characters);

    const response = await POST(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, {
        expectedUpdatedAt: article.updatedAt,
        characterId: "missing"
      }),
      context(article.id)
    );

    expect(response.status).toBe(400);
  });

  it("resolves a style-library ref into the full style guide text", async () => {
    const { articles, images, article } = await setup();
    const styleLibrary = new SqliteStyleLibraryRepository(createTestDatabase());
    const entry = await styleLibrary.upsert(PROFILE, "style-lab 导出");
    let received: Parameters<VisualPlanner["plan"]>[0] | undefined;
    const capturingPlanner: VisualPlanner = {
      plan: async (input) => {
        received = input;
        return { suggestions: [suggestion], stripDecision: null };
      }
    };
    const POST = createImagePlanRouteHandler(articles, images, capturingPlanner, null, styleLibrary);

    const response = await POST(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, {
        expectedUpdatedAt: article.updatedAt,
        style: `library:${entry.id}`
      }),
      context(article.id)
    );

    expect(response.status).toBe(200);
    expect(received?.style).toContain("【画风】");
    expect(received?.style).toContain(PROFILE.promptTemplate);
    expect(received?.style).toContain(`【主色板】${PROFILE.palette.join(" ")}`);
  });

  it("rejects a deleted style-library ref with 400", async () => {
    const { articles, images, article } = await setup();
    const POST = createImagePlanRouteHandler(
      articles,
      images,
      planner(),
      null,
      new SqliteStyleLibraryRepository(createTestDatabase())
    );

    const response = await POST(
      requestJson(`http://test/api/articles/${article.id}/image-plan`, {
        expectedUpdatedAt: article.updatedAt,
        style: "library:missing-id"
      }),
      context(article.id)
    );

    expect(response.status).toBe(400);
  });
});
