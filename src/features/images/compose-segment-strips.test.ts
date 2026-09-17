// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { DEFAULT_COMIC_STRIP_METRICS } from "./comic-strip";
import { composeSegmentStrips } from "./compose-segment-strips";
import {
  DEFAULT_STORYBOARD_FONT_ID,
  STORYBOARD_FONT_OPTIONS,
  resolveStoryboardFont
} from "./domain";
import { generateImageAsset } from "./generate-image-asset";
import type { ImageGenerator } from "./image-generator";
import type { StoryboardSegmentPlan } from "./repository";
import { SqliteImageAssetRepository } from "./sqlite-repository";

const FRAME_COLORS = ["#3355ff", "#33aa55", "#ff8800", "#aa33ff"];

/** 第三步设计分镜后的正文形状：每段「标题 + 文案」带 segmentId，收尾一张作者加的知识卡片（不烘图）。 */
const SEGMENT_COPY: ContentBlock[] = [
  {
    id: "seg1-heading",
    type: "heading",
    content: "眼睛为什么会酸",
    order: 0,
    level: 2,
    segmentId: "segment-1",
    version: 1
  },
  {
    id: "seg1-copy",
    type: "paragraph",
    content: "盯着屏幕时眨眼次数掉了一半，泪膜撑不住，眼睛就开始报警。",
    order: 1,
    segmentId: "segment-1",
    version: 1
  },
  {
    id: "seg2-heading",
    type: "heading",
    content: "怎么救",
    order: 2,
    level: 2,
    segmentId: "segment-2",
    version: 1
  },
  {
    id: "seg2-copy",
    type: "paragraph",
    content: "每二十分钟看远处二十秒，让睫状肌松一松。",
    order: 3,
    segmentId: "segment-2",
    version: 1
  },
  {
    id: "card-tail",
    type: "knowledge_card",
    content: "行动清单：设一个 20 分钟的休息提醒。",
    order: 4,
    segmentId: "segment-2",
    version: 1
  }
];

function segmentPlans(): StoryboardSegmentPlan[] {
  return [
    {
      id: "segment-1",
      sectionKey: "section-1",
      title: "眼睛为什么会酸",
      route: "image_text",
      copyBlockIds: ["seg1-heading", "seg1-copy"],
      frames: [{ prompt: "全景。主角揉眼睛，纯白背景", altText: "揉眼睛" }]
    },
    {
      id: "segment-2",
      sectionKey: "section-2",
      title: "怎么救",
      route: "image_text_image",
      copyBlockIds: ["seg2-heading", "seg2-copy"],
      frames: [
        { prompt: "中景。看向远处，纯白背景", altText: "看远处" },
        { prompt: "近景。桌上的定时器，纯白背景", altText: "定时器" }
      ]
    }
  ];
}

/** 生成器直接吐一张纯色 PNG：不联网，尺寸可预期。 */
function frameGenerator(index: number): ImageGenerator {
  return {
    generate: async () => ({
      remoteUrl: null,
      binary: await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: FRAME_COLORS[index % FRAME_COLORS.length]
        }
      })
        .png()
        .toBuffer(),
      format: "png"
    })
  };
}

async function storyboardFixture(options: { generateFrames?: boolean } = {}) {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-segment-"));

  const created = await articles.create({ topic: "护眼" });
  const saved = await articles.save({ ...created, blocks: SEGMENT_COPY }, created.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");

  const planned = await images.applyStoryboardPlan(
    saved.article.id,
    saved.article.updatedAt,
    segmentPlans()
  );
  if (planned.kind !== "saved") throw new Error("storyboard plan should save");

  let expectedUpdatedAt = planned.article.updatedAt;
  if (options.generateFrames !== false) {
    const frames = (planned.article.planning.storyboardSegments ?? []).flatMap(
      (segment) => segment.frameAssetIds
    );
    for (const [index, assetId] of frames.entries()) {
      const generated = await generateImageAsset(
        { articleId: saved.article.id, assetId, expectedUpdatedAt },
        { images, generator: frameGenerator(index), storageDir }
      );
      if (generated.kind !== "saved") throw new Error(`frame ${index} should generate`);
      expectedUpdatedAt = generated.article.updatedAt;
    }
  }

  return {
    articles,
    images,
    storageDir,
    articleId: saved.article.id,
    expectedUpdatedAt,
    planned
  };
}

describe("composeSegmentStrips", () => {
  it("composes one strip per segment and follows each segment's route", async () => {
    const fixture = await storyboardFixture();
    const result = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (result.kind !== "composed") throw new Error(`expected composed, got ${JSON.stringify(result)}`);

    expect(result.strips).toHaveLength(2);
    expect(result.strips[0]).toMatchObject({
      segmentId: "segment-1",
      route: "image_text",
      frames: 1
    });
    expect(result.strips[1]).toMatchObject({
      segmentId: "segment-2",
      route: "image_text_image",
      frames: 2
    });
    expect(result.strips.every((strip) => strip.width === DEFAULT_COMIC_STRIP_METRICS.width)).toBe(
      true
    );
    // 没选过字体时回落默认黑体，并把选择持久化进 planning。
    expect(result.fontFamily).toBe(DEFAULT_COMIC_STRIP_METRICS.fontFamily);
    const persisted = await fixture.articles.findById(fixture.articleId);
    expect(persisted?.planning.storyboardFontId).toBe(DEFAULT_STORYBOARD_FONT_ID);

    // 被烘图的文案块从正文消失，段图落回各段开头；作者加的知识卡片留在正文里。
    expect(result.article.blocks.map((block) => block.type)).toEqual([
      "image",
      "image",
      "knowledge_card"
    ]);
    expect(result.article.blocks.map((block) => block.assetId)).toEqual([
      result.strips[0]!.assetId,
      result.strips[1]!.assetId,
      undefined
    ]);
    expect(result.article.blocks[2]?.content).toContain("行动清单");

    const stripOne = result.assets.find((asset) => asset.id === result.strips[0]!.assetId);
    expect(stripOne?.type).toBe("comic_strip");
    expect(stripOne?.status).toBe("generated");
    expect(stripOne?.consumedContent?.blocks.map((block) => block.id)).toEqual([
      "seg1-heading",
      "seg1-copy"
    ]);
    // 两段之间的块都被各自的段图吃了，还原位置只能落在收尾的知识卡片之前。
    expect(stripOne?.consumedContent?.resumeBeforeBlockId).toBe("card-tail");

    const metadata = await sharp(await readFile(stripOne!.filePath!)).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(DEFAULT_COMIC_STRIP_METRICS.width);
  });

  it("bakes the chosen font and persists the choice for recomposition", async () => {
    const fixture = await storyboardFixture();
    const result = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt, fontId: "kaiti" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (result.kind !== "composed") throw new Error(`expected composed, got ${JSON.stringify(result)}`);

    expect(result.fontFamily).toBe(resolveStoryboardFont("kaiti").fontFamily);
    const persisted = await fixture.articles.findById(fixture.articleId);
    expect(persisted?.planning.storyboardFontId).toBe("kaiti");

    // 再拼一次不带 fontId：沿用已存选择，不回落默认。
    const again = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: result.article.updatedAt },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (again.kind !== "composed") throw new Error(`expected composed, got ${JSON.stringify(again)}`);
    expect(again.fontFamily).toBe(resolveStoryboardFont("kaiti").fontFamily);
  });

  it("replaces previous strips on recomposition instead of stacking a second set", async () => {
    const fixture = await storyboardFixture();
    const first = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (first.kind !== "composed") throw new Error("first compose should pass");

    const second = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: first.article.updatedAt, fontId: "yahei" },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    if (second.kind !== "composed") throw new Error("recompose should pass");

    expect(second.strips).toHaveLength(2);
    const stripAssets = second.assets.filter((asset) => asset.type === "comic_strip");
    expect(stripAssets).toHaveLength(2);
    expect(stripAssets.map((asset) => asset.id).sort()).toEqual(
      second.strips.map((strip) => strip.assetId).sort()
    );
    expect(second.article.blocks.map((block) => block.type)).toEqual([
      "image",
      "image",
      "knowledge_card"
    ]);
  });

  it("refuses to compose while frames are placeholders and leaves the body untouched", async () => {
    const fixture = await storyboardFixture({ generateFrames: false });
    const result = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );

    expect(result).toMatchObject({ kind: "not_ready" });
    if (result.kind === "not_ready") expect(result.message).toContain("没生成图片");
    const article = await fixture.articles.findById(fixture.articleId);
    expect(article?.blocks).toHaveLength(SEGMENT_COPY.length);
    expect(article?.blocks.filter((block) => block.type === "image")).toHaveLength(0);
  });

  it("refuses to compose when a designed frame asset is missing entirely", async () => {
    const fixture = await storyboardFixture();
    const planned = fixture.planned;
    if (planned.kind !== "saved") throw new Error("plan should save");
    const frameId = (planned.article.planning.storyboardSegments ?? [])[0]?.frameAssetIds[0];
    if (!frameId) throw new Error("frame should exist");
    // 帧生成推进过版本号，删除要用 fixture 里最新的锁 token。
    const removed = await fixture.images.remove(fixture.articleId, frameId, fixture.expectedUpdatedAt);
    if (removed.kind !== "saved") throw new Error(`frame removal should save, got ${JSON.stringify(removed)}`);

    const result = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: removed.article.updatedAt },
      { articles: fixture.articles, images: fixture.images, storageDir: fixture.storageDir }
    );
    expect(result).toMatchObject({ kind: "not_ready" });
  });

  it("returns not_ready when the article has no storyboard design", async () => {
    const db = createTestDatabase();
    const articles = new SqliteArticleRepository(db);
    const images = new SqliteImageAssetRepository(db);
    const created = await articles.create({ topic: "复利" });

    const result = await composeSegmentStrips(
      { articleId: created.id, expectedUpdatedAt: created.updatedAt },
      { articles, images }
    );
    expect(result).toMatchObject({ kind: "not_ready" });
  });

  it("rejects stale lock tokens", async () => {
    const fixture = await storyboardFixture();
    const result = await composeSegmentStrips(
      { articleId: fixture.articleId, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
      { articles: fixture.articles, images: fixture.images }
    );
    expect(result).toEqual({ kind: "conflict" });
  });
});

describe("resolveStoryboardFont", () => {
  it("falls back to the default for unknown or blank ids", () => {
    expect(resolveStoryboardFont("nope")).toBe(STORYBOARD_FONT_OPTIONS[0]);
    expect(resolveStoryboardFont(null)).toBe(STORYBOARD_FONT_OPTIONS[0]);
    expect(resolveStoryboardFont("  ")).toBe(STORYBOARD_FONT_OPTIONS[0]);
    expect(resolveStoryboardFont("kaiti").label).toBe("楷体");
  });
});
