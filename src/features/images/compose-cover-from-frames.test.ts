// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import {
  COMPOSED_COVER_CELL_WIDTH,
  COMPOSED_COVER_GUTTER,
  COMPOSED_COVER_HEIGHT,
  COMPOSED_COVER_MARGIN,
  COMPOSED_COVER_WIDTH,
  composeCoverFromFrames
} from "./compose-cover-from-frames";
import { generateImageAsset } from "./generate-image-asset";
import type { ImageGenerator } from "./image-generator";
import type { StoryboardSegmentPlan } from "./repository";
import { SqliteImageAssetRepository } from "./sqlite-repository";

/**
 * 「三帧横拼」封面。
 *
 * 核心回归面有三块：
 * 1. 走的是 ensureCover 幂等通道——绝不能碰分镜帧（那是 applyPlan 的事故现场）；
 * 2. 选帧缺省按段落顺序取前三张「已生成且落了盘」的帧，指定 id 则按指定顺序；
 * 3. 产物是真实落盘的 PNG，尺寸是 2.35:1 画布（1440×613）。
 */

const FRAME_COLORS = ["#3355ff", "#33aa55", "#ff8800"];

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
    content: "盯着屏幕时眨眼次数掉了一半，眼睛就开始报警。",
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
  }
];

/** 两个有帧路由的段，凑出整整 3 张帧（1 + 2）。 */
function segmentPlans(): StoryboardSegmentPlan[] {
  return [
    {
      id: "segment-1",
      sectionKey: "section-1",
      title: "眼睛为什么会酸",
      route: "image_text",
      copyBlockIds: ["seg1-heading", "seg1-copy"],
      frames: [{ prompt: "全景。主角揉眼睛", altText: "揉眼睛" }]
    },
    {
      id: "segment-2",
      sectionKey: "section-2",
      title: "怎么救",
      route: "image_text_image",
      copyBlockIds: ["seg2-heading", "seg2-copy"],
      frames: [
        { prompt: "中景。看向远处", altText: "看远处" },
        { prompt: "近景。桌上的定时器", altText: "定时器" }
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

async function coverFixture(
  options: { generateFrames?: boolean } = {}
) {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-cover-"));

  const created = await articles.create({ topic: "护眼" });
  const saved = await articles.save(
    { ...created, blocks: SEGMENT_COPY },
    created.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("fixture article should save");

  const planned = await images.applyStoryboardPlan(
    saved.article.id,
    saved.article.updatedAt,
    segmentPlans()
  );
  if (planned.kind !== "saved") throw new Error("storyboard plan should save");

  let expectedUpdatedAt = planned.article.updatedAt;
  const frameIds = (planned.article.planning.storyboardSegments ?? []).flatMap(
    (segment) => segment.frameAssetIds
  );
  if (options.generateFrames !== false) {
    for (const [index, assetId] of frameIds.entries()) {
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
    frameIds
  };
}

describe("composeCoverFromFrames", () => {
  it("joins the first three generated frames into a 1440x613 cover PNG", async () => {
    const fixture = await coverFixture();
    const result = await composeCoverFromFrames(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    if (result.kind !== "saved") {
      throw new Error(`expected saved, got ${JSON.stringify(result)}`);
    }

    const cover = result.assets.find((asset) => asset.type === "cover");
    expect(cover).toMatchObject({
      type: "cover",
      status: "generated",
      anchorBlockId: null
    });
    expect(cover?.filePath).toBeTruthy();

    // 产物是真实落盘的 PNG，画布尺寸固定 2.35:1（1440×613）。
    const binary = await readFile(cover!.filePath!);
    const meta = await sharp(binary).metadata();
    expect(meta.width).toBe(COMPOSED_COVER_WIDTH);
    expect(meta.height).toBe(COMPOSED_COVER_HEIGHT);
    expect(meta.format).toBe("png");

    // 四周与格间是白边：左上角与第一条格缝都应接近纯白。
    const corner = await sharp(binary)
      .extract({ left: 0, top: 0, width: 20, height: 20 })
      .png()
      .toBuffer();
    const cornerMeans = (await sharp(corner).stats()).channels
      .slice(0, 3)
      .map((channel) => Math.round(channel.mean));
    expect(cornerMeans.every((value) => value >= 250)).toBe(true);
    const gapLeft = COMPOSED_COVER_MARGIN + COMPOSED_COVER_CELL_WIDTH;
    const gap = await sharp(binary)
      .extract({
        left: gapLeft + 4,
        top: COMPOSED_COVER_MARGIN,
        width: COMPOSED_COVER_GUTTER - 8,
        height: 40
      })
      .png()
      .toBuffer();
    const gapMeans = (await sharp(gap).stats()).channels
      .slice(0, 3)
      .map((channel) => Math.round(channel.mean));
    expect(gapMeans.every((value) => value >= 250)).toBe(true);
  });

  it("reports not_enough_frames when fewer than three frames are generated", async () => {
    const fixture = await coverFixture({ generateFrames: false });

    const result = await composeCoverFromFrames(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { images: fixture.images, storageDir: fixture.storageDir }
    );

    expect(result.kind).toBe("not_enough_frames");
    if (result.kind === "not_enough_frames") {
      expect(result.message).toContain("不足 3 张");
    }
  });

  it("honors explicit assetIds in the given left-to-right order", async () => {
    const fixture = await coverFixture();
    // 指定乱序：第三帧（橙）放最左，第二帧（绿）居中，第一帧（蓝）放最右。
    const [first, second, third] = fixture.frameIds;
    const reordered = [third, second, first];

    const result = await composeCoverFromFrames(
      {
        articleId: fixture.articleId,
        expectedUpdatedAt: fixture.expectedUpdatedAt,
        assetIds: reordered
      },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    if (result.kind !== "saved") {
      throw new Error(`expected saved, got ${JSON.stringify(result)}`);
    }

    // 纯色帧裁剪填充后颜色不变：逐格取三通道均值验证左中右顺序。
    const cover = result.assets.find((asset) => asset.type === "cover");
    const binary = await readFile(cover!.filePath!);
    const cellMeans = await Promise.all(
      [0, 1, 2].map(async (index) => {
        const cell = await sharp(binary)
          .extract({
            left: COMPOSED_COVER_MARGIN + index * (COMPOSED_COVER_CELL_WIDTH + COMPOSED_COVER_GUTTER),
            top: COMPOSED_COVER_MARGIN,
            width: COMPOSED_COVER_CELL_WIDTH,
            height: COMPOSED_COVER_HEIGHT - COMPOSED_COVER_MARGIN * 2
          })
          .png()
          .toBuffer();
        const stats = await sharp(cell).stats();
        return stats.channels.slice(0, 3).map((channel) => Math.round(channel.mean));
      })
    );
    const near = (actual: number[], expected: number[]) =>
      // channels 会带上第 4 项 alpha，只比前三个颜色通道。
      actual.slice(0, 3).every((value, index) => Math.abs(value - expected[index]) <= 1);
    // 左=橙 #ff8800，中=绿 #33aa55，右=蓝 #3355ff。
    expect(near(cellMeans[0], [255, 136, 0])).toBe(true);
    expect(near(cellMeans[1], [51, 170, 85])).toBe(true);
    expect(near(cellMeans[2], [51, 85, 255])).toBe(true);
  });

  it("rejects assetIds that are missing or not generated frames", async () => {
    const fixture = await coverFixture();

    const result = await composeCoverFromFrames(
      {
        articleId: fixture.articleId,
        expectedUpdatedAt: fixture.expectedUpdatedAt,
        assetIds: [fixture.frameIds[0], "no-such-asset", fixture.frameIds[1]]
      },
      { images: fixture.images, storageDir: fixture.storageDir }
    );

    expect(result.kind).toBe("not_enough_frames");
  });

  it("maps a stale version to conflict and a missing article to not_found", async () => {
    const fixture = await coverFixture();

    const stale = await composeCoverFromFrames(
      { articleId: fixture.articleId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    expect(stale.kind).toBe("conflict");

    const missing = await composeCoverFromFrames(
      { articleId: "missing-article", expectedUpdatedAt: fixture.expectedUpdatedAt },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    expect(missing.kind).toBe("not_found");
  });

  it("never touches the storyboard frames and produces a fresh file on re-compose", async () => {
    const fixture = await coverFixture();

    const first = await composeCoverFromFrames(
      { articleId: fixture.articleId, expectedUpdatedAt: fixture.expectedUpdatedAt },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    if (first.kind !== "saved") throw new Error(`first compose should save, got ${first.kind}`);
    const firstCover = first.assets.find((asset) => asset.type === "cover");
    const firstPath = firstCover?.filePath ?? null;

    const second = await composeCoverFromFrames(
      { articleId: fixture.articleId, expectedUpdatedAt: first.article.updatedAt },
      { images: fixture.images, storageDir: fixture.storageDir }
    );
    if (second.kind !== "saved") throw new Error(`second compose should save, got ${second.kind}`);
    const secondCover = second.assets.find((asset) => asset.type === "cover");

    // 重拼走 generationId 命名新文件：旧版本留在磁盘可回溯，不覆盖历史。
    expect(secondCover?.filePath).toBeTruthy();
    expect(secondCover?.filePath).not.toBe(firstPath);
    // 帧一张不少、状态原样——ensureCover 通道的铁律。
    const framesAfter = second.assets.filter((asset) => asset.type === "storyboard");
    expect(framesAfter.map((asset) => asset.id)).toEqual(fixture.frameIds);
    expect(framesAfter.every((asset) => asset.status === "generated")).toBe(true);
  });
});
