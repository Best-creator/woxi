// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { VisualPlannerError } from "@/features/images/openai-visual-planner";
import type { VisualPlanner } from "@/features/images/visual-planner";
import type { ComicStripModeDecision } from "./comic-strip-mode-router";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { planImages } from "./plan-images";

const suggestion: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "文章封面",
  prompt: "绿色信息图",
  altText: "复利概念封面",
  aspectRatio: "cover"
};

class Planner implements VisualPlanner {
  calls = 0;

  constructor(
    private readonly run: () => Promise<ImagePlanSuggestion[]> = async () => [suggestion],
    private readonly stripDecision: ComicStripModeDecision | null = null
  ) {}

  async plan() {
    this.calls += 1;
    return { suggestions: await this.run(), stripDecision: this.stripDecision };
  }
}

async function createArticleWithContent() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const created = await articles.create({ topic: "复利" });
  const saved = await articles.save(
    {
      ...created,
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          content: "复利会让收益持续累积。",
          order: 0,
          version: 1
        }
      ]
    },
    created.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("article fixture should save");
  return { articles, images, article: saved.article };
}

describe("planImages", () => {
  it("reports a missing article", async () => {
    const db = createTestDatabase();
    const result = await planImages(
      "missing",
      "2026-01-01T00:00:00.000Z",
      new SqliteArticleRepository(db),
      new SqliteImageAssetRepository(db),
      new Planner()
    );

    expect(result).toEqual({ kind: "not_found" });
  });

  it("does not invoke the planner when an article has no non-image content blocks", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const images = new SqliteImageAssetRepository(db);
    const article = await articles.create({ topic: "复利" });
    const planner = new Planner();

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result).toEqual({ kind: "no_content" });
    expect(planner.calls).toBe(0);
  });

  it("refuses to plan for articles that already designed storyboard segments in step 3", async () => {
    const { articles, images, article } = await createArticleWithContent();
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
              copyBlockIds: ["paragraph-1"],
              frameAssetIds: [],
              order: 0
            }
          ]
        }
      },
      article.updatedAt
    );
    if (designed.kind !== "saved") throw new Error("storyboard fixture should save");
    const planner = new Planner();

    const result = await planImages(
      article.id,
      designed.article.updatedAt,
      articles,
      images,
      planner
    );

    // 规划器的重规划会删掉/禁用第三步的帧资产——分镜文章直接拒绝，保护设计稿。
    expect(result).toEqual({ kind: "storyboard_locked" });
    expect(planner.calls).toBe(0);
    expect(await images.list(article.id)).toEqual([]);
  });

  it("persists successful planner suggestions", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner();

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result.kind).toBe("planned");
    if (result.kind === "planned") {
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]).toMatchObject({ altText: "复利概念封面", status: "placeholder" });
      // 无决策时 planning 不新增排法字段。
      expect(result.article.planning.comicStripMode).toBeUndefined();
    }
  });

  it("persists the strip mode decision into article planning for the composer to consume", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner(async () => [suggestion], {
      mode: "image_text_image",
      reason: "每格文案短且格数为偶数，适合连环画节奏"
    });

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result.kind).toBe("planned");
    if (result.kind === "planned") {
      expect(result.article.planning.comicStripMode).toBe("image_text_image");
      expect(result.article.planning.comicStripReason).toBe("每格文案短且格数为偶数，适合连环画节奏");
      // 从库里重新读出来也在（持久化，不只改了返回值）。
      const reread = await articles.findById(article.id);
      expect(reread?.planning.comicStripMode).toBe("image_text_image");
    }
  });

  it("returns a conflict when the article changes while planning", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner(async () => {
      const current = await articles.findById(article.id);
      if (!current) throw new Error("article should exist");
      await articles.save({ ...current, title: "已并发更新" }, current.updatedAt);
      return [suggestion];
    });

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result).toEqual({ kind: "conflict" });
    expect(await images.list(article.id)).toEqual([]);
  });

  it("does not persist a plan when the planner fails", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner(async () => {
      throw new VisualPlannerError("timeout", "provider timeout");
    });

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result).toEqual({ kind: "planner_error", message: "配图分析超时，请重试" });
    expect(await images.list(article.id)).toEqual([]);
  });

  it("keeps repository plan validation separate from planner failures", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner(async () =>
      Array.from({ length: 13 }, (_, index) => ({
        ...suggestion,
        purpose: `图片 ${index + 1}`,
        prompt: `提示 ${index + 1}`,
        altText: `替代文本 ${index + 1}`
      }))
    );

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result).toEqual({
      kind: "invalid_plan",
      source: "repository",
      message: "图片计划最多支持 12 张图片"
    });
  });
});
