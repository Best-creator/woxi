// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { VisualPlannerError } from "@/features/images/openai-visual-planner";
import type { VisualPlanner } from "@/features/images/visual-planner";
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
    private readonly run: () => Promise<ImagePlanSuggestion[]> = async () => [suggestion]
  ) {}

  async plan() {
    this.calls += 1;
    return this.run();
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

  it("persists successful planner suggestions", async () => {
    const { articles, images, article } = await createArticleWithContent();
    const planner = new Planner();

    const result = await planImages(article.id, article.updatedAt, articles, images, planner);

    expect(result.kind).toBe("planned");
    if (result.kind === "planned") {
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]).toMatchObject({ altText: "复利概念封面", status: "placeholder" });
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
