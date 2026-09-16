// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { composeComicStrips, removeComicStrips } from "./compose-comic-strip";
import type { ImagePlanSuggestion } from "./domain";
import { generateImageAsset } from "./generate-image-asset";
import { removeGenerationFile } from "./generation-files";
import { DEFAULT_COMIC_STRIP_METRICS } from "./comic-strip";
import type { ImageGenerator } from "./image-generator";
import { SqliteImageAssetRepository } from "./sqlite-repository";

const PANEL_COLORS = ["#3355ff", "#33aa55", "#ff8800"];

/** 一格一个「分镜标题 + 一句文案」，正是漫画预设应该产生的形状。 */
const COMIC_SOURCE: ContentBlock[] = [
  { id: "h1", type: "heading", content: "第一格：眼睛为什么会酸", order: 0, level: 2, version: 1 },
  { id: "p1", type: "paragraph", content: "盯着屏幕时眨眼次数掉了一半。", order: 1, version: 1 },
  { id: "h2", type: "heading", content: "第二格：眨眼少了会怎样", order: 2, level: 2, version: 1 },
  { id: "p2", type: "paragraph", content: "泪膜撑不住，眼睛就开始报警。", order: 3, version: 1 },
  { id: "h3", type: "heading", content: "第三格：怎么救", order: 4, level: 2, version: 1 },
  { id: "p3", type: "paragraph", content: "二十分钟看远处二十秒。", order: 5, version: 1 }
];

const PANEL_ANCHORS = ["p1", "p2", "p3"];

/** 生成器直接吐一张纯色 PNG：不联网，尺寸和颜色都可预期。 */
function panelGenerator(index: number): ImageGenerator {
  return {
    generate: async () => ({
      remoteUrl: null,
      binary: await sharp({
        create: { width: 400, height: 300, channels: 3, background: PANEL_COLORS[index % 3] }
      })
        .png()
        .toBuffer(),
      format: "png"
    })
  };
}

async function comicFixture() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-comic-"));

  const created = await articles.create({ topic: "护眼" });
  const saved = await articles.save({ ...created, blocks: COMIC_SOURCE }, created.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");

  const suggestions: ImagePlanSuggestion[] = PANEL_ANCHORS.map((anchorBlockId, index) => ({
    type: "storyboard",
    anchorBlockId,
    purpose: `分镜 ${index + 1}`,
    prompt: `分镜 ${index + 1} 画面`,
    altText: `分镜 ${index + 1}`,
    aspectRatio: "square"
  }));

  const plan = await images.applyPlan(saved.article.id, saved.article.updatedAt, suggestions);
  if (plan.kind !== "saved") throw new Error("plan should save");

  let expectedUpdatedAt = plan.article.updatedAt;
  for (const [index, asset] of plan.assets.entries()) {
    const generated = await generateImageAsset(
      { articleId: saved.article.id, assetId: asset.id, expectedUpdatedAt },
      { images, generator: panelGenerator(index), storageDir }
    );
    if (generated.kind !== "saved") throw new Error(`panel ${index} should generate`);
    expectedUpdatedAt = generated.article.updatedAt;
  }

  return { articles, images, storageDir, articleId: saved.article.id, expectedUpdatedAt };
}

describe("composeComicStrips", () => {
  it("replaces the panels and their captions with one composited strip", async () => {
    const fixture = await comicFixture();
    const result = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "image_text_image" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );

    if (result.kind !== "composed") throw new Error(`expected composed, got ${result.kind}`);
    expect(result.strips).toHaveLength(1);
    expect(result.strips[0].panels).toBe(3);
    expect(result.strips[0].width).toBe(DEFAULT_COMIC_STRIP_METRICS.width);

    // 正文里那三格图文整体消失，只在原位留下一张长图。
    expect(result.article.blocks).toHaveLength(1);
    expect(result.article.blocks[0]).toMatchObject({
      type: "image",
      assetId: result.strips[0].assetId,
      order: 0
    });

    const strip = result.assets.find((asset) => asset.id === result.strips[0].assetId);
    expect(strip?.type).toBe("comic_strip");
    expect(strip?.status).toBe("generated");
    // 原文快照随身带着，取消长图才还原得回去。
    expect(strip?.consumedContent?.blocks.map((block) => block.id)).toEqual([
      "h1",
      "p1",
      "h2",
      "p2",
      "h3",
      "p3"
    ]);
    expect(strip?.consumedContent?.resumeBeforeBlockId).toBeNull();

    const metadata = await sharp(await readFile(strip!.filePath!)).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(result.strips[0].width);
    expect(metadata.height).toBe(result.strips[0].height);
  });

  it("lets the mode router decide when the request asks for auto", async () => {
    const fixture = await comicFixture();
    const decide = vi.fn().mockResolvedValue({ mode: "text_image", reason: "先铺垫再给画面" });
    const result = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "auto" },
      {
        articles: fixture.articles,
        images: fixture.images,
        storageDir: fixture.storageDir,
        modeRouter: { decide }
      }
    );

    if (result.kind !== "composed") throw new Error(`expected composed, got ${result.kind}`);
    // 路由收到的是分镜特征（标题/文案/字数）与正文节选，决策写回回执与用途。
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        panels: expect.arrayContaining([
          expect.objectContaining({ title: "第一格：眼睛为什么会酸", chars: expect.any(Number) })
        ]),
        excerpt: expect.stringContaining("眨眼")
      })
    );
    expect(result.strips[0]).toMatchObject({ mode: "text_image", reason: "先铺垫再给画面", panels: 3 });
    const strip = result.assets.find((asset) => asset.id === result.strips[0].assetId);
    expect(strip?.purpose).toContain("text_image");
  });

  it("falls back to the deterministic rule when the auto router fails", async () => {
    const fixture = await comicFixture();
    const result = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "auto" },
      {
        articles: fixture.articles,
        images: fixture.images,
        storageDir: fixture.storageDir,
        modeRouter: { decide: vi.fn().mockRejectedValue(new Error("模型抽风")) }
      }
    );

    if (result.kind !== "composed") throw new Error(`expected composed, got ${result.kind}`);
    // 夹具三格短文案、格数为奇数：规则给出 image_text，理由注明模型不可用。
    expect(result.strips[0].mode).toBe("image_text");
    expect(result.strips[0].reason).toContain("模型不可用");
  });

  it("puts the text back exactly where it was when the strip is cancelled", async () => {
    const fixture = await comicFixture();
    const composed = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "image_text" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (composed.kind !== "composed") throw new Error(`expected composed, got ${composed.kind}`);

    const removed = await removeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: composed.article.updatedAt },
      { articles: fixture.articles, images: fixture.images }
    );
    if (removed.kind !== "removed") throw new Error(`expected removed, got ${removed.kind}`);

    expect(removed.removed).toBe(1);
    expect(removed.assets.some((asset) => asset.type === "comic_strip")).toBe(false);
    // 文字块顺序原样回来，分镜图也重新插回各自的位置。
    expect(
      removed.article.blocks
        .filter((block) => block.type !== "image")
        .map((block) => block.id)
    ).toEqual(["h1", "p1", "h2", "p2", "h3", "p3"]);
    // 分镜图统一「跟在自己的锚点段落后」——和图片规划时的插入规则一致，
    // 所以是 标题 → 文案 → 图 的循环，而不是图插在段落前面。
    expect(removed.article.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "heading",
      "paragraph",
      "image",
      "heading",
      "paragraph",
      "image"
    ]);
  });

  it("actually changes the layout when the mode changes", async () => {
    const fixture = await comicFixture();
    const deps = {
      articles: fixture.articles,
      images: fixture.images,
      storageDir: fixture.storageDir
    };

    const sandwich = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "image_text_image" },
      deps
    );
    if (sandwich.kind !== "composed") throw new Error("expected composed");

    // 关键：这里**不先取消**上一张长图就直接换排法——作者要的就是能自由来回切三种排法。
    // 此刻正文里只剩那张长图，被替换的图文全在它的快照里；识别必须先还原快照才认得出分镜。
    const perPanel = await composeComicStrips(
      {
        articleId: fixture.articleId,
        expectedUpdatedAt: sandwich.article.updatedAt,
        mode: "image_text"
      },
      deps
    );
    if (perPanel.kind !== "composed") throw new Error("expected composed");

    // 换排法不能丢格：三格一张不少。
    expect(perPanel.strips[0].panels).toBe(3);
    // 两图夹一文把两格的文案并进一条带子，比「一格一图一文」少一条文字带，所以更矮。
    expect(sandwich.strips[0].height).toBeLessThan(perPanel.strips[0].height);
  });

  it("replaces the previous strip instead of stacking a second one", async () => {
    const fixture = await comicFixture();
    const deps = {
      articles: fixture.articles,
      images: fixture.images,
      storageDir: fixture.storageDir
    };
    const first = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "image_text" },
      deps
    );
    if (first.kind !== "composed") throw new Error("expected composed");
    const firstPath = first.assets.find((asset) => asset.id === first.strips[0].assetId)?.filePath;

    const second = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: first.article.updatedAt, mode: "text_image" },
      deps
    );
    if (second.kind !== "composed") throw new Error("expected composed");

    expect(second.assets.filter((asset) => asset.type === "comic_strip")).toHaveLength(1);
    expect(second.strips[0].assetId).not.toBe(first.strips[0].assetId);
    // 旧长图连文件一起清掉，否则磁盘上会攒下一堆没人指向的图。
    await expect(readFile(firstPath!)).rejects.toThrow();
  });

  it("refuses to compose while a panel still has no real image", async () => {
    const fixture = await comicFixture();
    // 把第三格退回「待生成」：这一格在长图里只会是一块灰底占位，不如不做。
    const assets = await fixture.images.list(fixture.articleId);
    const third = assets.find((asset) => asset.purpose === "分镜 3");
    if (!third?.filePath) throw new Error("fixture should generate three panels");
    const deleted = await fixture.images.deleteGeneration(
      fixture.articleId,
      third.id,
      (await fixture.images.listGenerationsForAsset(fixture.articleId, third.id))[0]!.id,
      fixture.expectedUpdatedAt
    );
    if (deleted.kind !== "saved") throw new Error("generation should delete");
    await removeGenerationFile(third.filePath);

    const result = await composeComicStrips(
      {
        articleId: fixture.articleId,
        expectedUpdatedAt: deleted.article.updatedAt,
        mode: "image_text"
      },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );

    expect(result).toMatchObject({ kind: "not_ready" });
    if (result.kind !== "not_ready") throw new Error("expected not_ready");
    expect(result.message).toContain("还有 1 格");
    // 正文一个字都没动——拒绝合成时不能留下半成品。
    expect(
      (await fixture.articles.findById(fixture.articleId))?.blocks.filter(
        (block) => block.type !== "image"
      ).length
    ).toBe(COMIC_SOURCE.length);
  });

  it("tells the author when there is only a single panel to work with", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const images = new SqliteImageAssetRepository(db);
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-comic-"));
    const created = await articles.create({ topic: "护眼" });
    const saved = await articles.save(
      { ...created, blocks: COMIC_SOURCE.slice(0, 2) },
      created.updatedAt
    );
    if (saved.kind !== "saved") throw new Error("fixture should save");
    const plan = await images.applyPlan(saved.article.id, saved.article.updatedAt, [
      {
        type: "storyboard",
        anchorBlockId: "p1",
        purpose: "分镜 1",
        prompt: "分镜 1 画面",
        altText: "分镜 1",
        aspectRatio: "square"
      }
    ]);
    if (plan.kind !== "saved") throw new Error("plan should save");

    const result = await composeComicStrips(
      { articleId: saved.article.id, expectedUpdatedAt: plan.article.updatedAt, mode: "image_text" },
      { articles, images, storageDir }
    );

    expect(result).toMatchObject({ kind: "not_ready" });
    if (result.kind !== "not_ready") throw new Error("expected not_ready");
    expect(result.message).toContain("至少要两格");
  });

  it("reports the exact shortfall when there are not enough panels", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const images = new SqliteImageAssetRepository(db);
    const created = await articles.create({ topic: "护眼" });
    const saved = await articles.save({ ...created, blocks: COMIC_SOURCE }, created.updatedAt);
    if (saved.kind !== "saved") throw new Error("fixture should save");

    const empty = await composeComicStrips(
      { articleId: saved.article.id, expectedUpdatedAt: saved.article.updatedAt, mode: "image_text" },
      { articles, images }
    );
    expect(empty).toMatchObject({ kind: "not_ready" });
    if (empty.kind !== "not_ready") throw new Error("expected not_ready");
    expect(empty.message).toContain("还没有分镜配图");
  });

  it("surfaces missing articles and stale versions", async () => {
    const fixture = await comicFixture();

    const missing = await composeComicStrips(
      { articleId: "no-such-article", expectedUpdatedAt: fixture.expectedUpdatedAt, mode: "image_text" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    expect(missing).toEqual({ kind: "not_found" });

    const stale = await composeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z", mode: "image_text" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    expect(stale).toEqual({ kind: "conflict" });
  });
});

describe("removeComicStrips", () => {
  it("is a no-op when there is no strip to cancel", async () => {
    const fixture = await comicFixture();
    const result = await removeComicStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { articles: fixture.articles, images: fixture.images }
    );

    if (result.kind !== "removed") throw new Error(`expected removed, got ${result.kind}`);
    expect(result.removed).toBe(0);
    expect(
      result.article.blocks.filter((block) => block.type !== "image").map((block) => block.id)
    ).toEqual(["h1", "p1", "h2", "p2", "h3", "p3"]);
  });

  it("surfaces missing articles and stale versions", async () => {
    const fixture = await comicFixture();

    expect(
      await removeComicStrips(
        { articleId: "no-such-article", expectedUpdatedAt: fixture.expectedUpdatedAt },
        { articles: fixture.articles, images: fixture.images }
      )
    ).toEqual({ kind: "not_found" });

    expect(
      await removeComicStrips(
        { articleId: fixture.articleId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
        { articles: fixture.articles, images: fixture.images }
      )
    ).toEqual({ kind: "conflict" });
  });
});
