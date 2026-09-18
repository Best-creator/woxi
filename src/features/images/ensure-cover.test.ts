// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { defaultCoverPrompt } from "@/features/images/domain";
import type { StoryboardSegmentPlan } from "@/features/images/repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { twoBlocks } from "../../../tests/fixtures/article";
import { createTestDatabase } from "../../../tests/helpers/test-db";

/**
 * 封面槽位的幂等创建。
 *
 * 这块的**核心回归面**是「不能顺手删掉分镜帧」：视觉规划器的 applyPlan 会清掉
 * 同文章里未手动编辑的 placeholder 资产，而分镜帧正好长这样。分镜文章必须走
 * ensureCover 这条只增不删的路，否则作者在第三步设计好的帧会被悄悄抹掉。
 */

const SEGMENTS: StoryboardSegmentPlan[] = [
  {
    id: "segment-1",
    sectionKey: "section-1",
    title: "什么是机会成本",
    route: "image_text",
    copyBlockIds: ["block-heading-1", "block-paragraph-1"],
    frames: [
      { prompt: "全景。讲解机会成本。", altText: "机会成本讲解" },
      { prompt: "近景。写在纸上的选择。", altText: "纸上的选择" }
    ]
  }
];

async function createStoryboardArticle() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  article.blocks = twoBlocks();
  const saved = await articles.save(article, article.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");

  const planned = await images.applyStoryboardPlan(saved.article.id, saved.article.updatedAt, SEGMENTS);
  if (planned.kind !== "saved") throw new Error("fixture storyboard should save");
  return { articles, images, article: planned.article, planned };
}

describe("ensureCover", () => {
  it("creates a cover slot and leaves every storyboard frame untouched", async () => {
    const { images, article, planned } = await createStoryboardArticle();
    const frameIds = planned.assets
      .filter((asset) => asset.type === "storyboard")
      .map((asset) => asset.id);
    expect(frameIds.length).toBeGreaterThan(0);

    const result = await images.ensureCover(article.id, article.updatedAt, {
      prompt: "封面：一张摊开的账本与两条岔路",
      aspectRatio: "landscape",
      altText: "机会成本封面"
    });
    if (result.kind !== "ready") throw new Error("cover should be ready");

    expect(result.created).toBe(true);
    expect(result.asset).toMatchObject({
      type: "cover",
      // 封面是公众号头图，不进正文序列，所以永远没有锚点。
      anchorBlockId: null,
      aspectRatio: "landscape",
      status: "placeholder",
      purpose: "封面图",
      prompt: "封面：一张摊开的账本与两条岔路",
      altText: "机会成本封面",
      manuallyEdited: false,
      consumedContent: null
    });
    // 帧一张不少、状态没被动过——这正是不能复用 applyPlan 的原因。
    const framesAfter = result.assets.filter((asset) => asset.type === "storyboard");
    expect(framesAfter.map((asset) => asset.id)).toEqual(frameIds);
    expect(framesAfter.every((asset) => asset.status === "placeholder")).toBe(true);
    // 分镜计划也要还在。
    expect(result.article.planning.storyboardSegments?.map((segment) => segment.id)).toEqual([
      "segment-1"
    ]);
    expect(result.article.updatedAt).not.toBe(article.updatedAt);
  });

  it("is idempotent and never overwrites what the author already wrote", async () => {
    const { images, article } = await createStoryboardArticle();

    const first = await images.ensureCover(article.id, article.updatedAt, { prompt: "作者写的提示词" });
    if (first.kind !== "ready") throw new Error("first ensure should be ready");

    const second = await images.ensureCover(first.article.id, first.article.updatedAt, {
      prompt: "后来者不该覆盖"
    });
    if (second.kind !== "ready") throw new Error("second ensure should be ready");

    expect(second.created).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.prompt).toBe("作者写的提示词");
    expect(second.assets.filter((asset) => asset.type === "cover")).toHaveLength(1);
  });

  it("falls back to a deterministic cover prompt when the author gave none", async () => {
    const { images, article } = await createStoryboardArticle();
    const expected = defaultCoverPrompt(article);

    const result = await images.ensureCover(article.id, article.updatedAt);
    if (result.kind !== "ready") throw new Error("cover should be ready");

    expect(result.asset.prompt).toBe(expected);
    expect(result.asset.aspectRatio).toBe("cover");
    expect(result.asset.altText).toContain(article.title);
  });

  it("reports a conflict when the article has moved on, and not_found for a missing article", async () => {
    const { images, article } = await createStoryboardArticle();

    const stale = await images.ensureCover(article.id, "2020-01-01T00:00:00.000Z");
    expect(stale.kind).toBe("conflict");

    const missing = await images.ensureCover("missing-article", article.updatedAt);
    expect(missing.kind).toBe("not_found");
  });
});
