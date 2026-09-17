// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { StoryboardSegmentPlan } from "@/features/images/repository";
import { twoBlocks } from "../../../tests/fixtures/article";
import { createTestDatabase } from "../../../tests/helpers/test-db";

async function createFixture() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  article.blocks = twoBlocks();
  const saved = await articles.save(article, article.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");
  return { db, articles, images, article: saved.article };
}

function segmentPlan(overrides: Partial<StoryboardSegmentPlan> = {}): StoryboardSegmentPlan {
  return {
    id: overrides.id ?? "segment-1",
    sectionKey: overrides.sectionKey ?? "section-1",
    title: overrides.title ?? "什么是机会成本",
    route: overrides.route ?? "image_text",
    copyBlockIds: overrides.copyBlockIds ?? ["block-heading-1", "block-paragraph-1"],
    frames: overrides.frames ?? [
      { prompt: "全景。主角讲解机会成本，纯白背景。画面文字：对白气泡『机会成本』", altText: "机会成本讲解" }
    ]
  };
}

describe("applyStoryboardPlan", () => {
  it("creates placeholder frame assets and persists segments into planning", async () => {
    const { db, articles, images, article } = await createFixture();
    const plan: StoryboardSegmentPlan[] = [
      segmentPlan({ id: "segment-1", route: "image_text" }),
      segmentPlan({
        id: "segment-2",
        sectionKey: "section-2",
        title: "如何权衡",
        route: "image_text_image",
        copyBlockIds: ["block-paragraph-2"],
        frames: [
          { prompt: "中景。第一帧", altText: "第一帧" },
          { prompt: "近景。第二帧", altText: "第二帧" }
        ]
      })
    ];

    const result = await images.applyStoryboardPlan(article.id, article.updatedAt, plan);
    if (result.kind !== "saved") throw new Error("plan should save");

    expect(result.removedFilePaths).toEqual([]);
    const segments = result.article.planning.storyboardSegments ?? [];
    expect(segments.map((segment) => segment.id)).toEqual(["segment-1", "segment-2"]);
    expect(segments[1]?.frameAssetIds).toHaveLength(2);

    // 帧资产落库为 placeholder 分镜，且 planning 已持久化到文章行。
    for (const segment of segments) {
      expect(segment.frameAssetIds.length).toBeGreaterThan(0);
      for (const assetId of segment.frameAssetIds) {
        const asset = result.assets.find((candidate) => candidate.id === assetId);
        expect(asset).toMatchObject({
          type: "storyboard",
          status: "placeholder",
          anchorBlockId: null,
          manuallyEdited: false
        });
      }
    }
    const persisted = await articles.findById(article.id);
    expect(persisted?.planning.storyboardSegments).toEqual(segments);

    const rows = db
      .prepare("SELECT COUNT(*) AS count FROM image_assets WHERE article_id = ? AND type = 'storyboard'")
      .get(article.id) as unknown as { count: number };
    expect(rows.count).toBe(3);
  });

  it("retires the previous design's frames and returns their file paths", async () => {
    const { db, images, article } = await createFixture();
    const first = await images.applyStoryboardPlan(article.id, article.updatedAt, [
      segmentPlan({ id: "segment-old" })
    ]);
    if (first.kind !== "saved") throw new Error("first plan should save");
    const oldFrameId = (first.article.planning.storyboardSegments ?? [])[0]?.frameAssetIds[0];
    if (!oldFrameId) throw new Error("old frame should exist");

    // 给旧帧造一条带文件的生成版本，验证重设计时版本行被清、路径被交回。
    db.prepare(
      `INSERT INTO image_asset_generations (id, article_id, asset_id, prompt, model, file_path, public_url, selected, created_at)
       VALUES ('gen-old', ?, ?, '旧帧提示词', 'demo', '.data/generated-images/old.png', NULL, 1, ?)`
    ).run(article.id, oldFrameId, first.article.updatedAt);

    const second = await images.applyStoryboardPlan(article.id, first.article.updatedAt, [
      segmentPlan({ id: "segment-new", title: "重设计后的段" })
    ]);
    if (second.kind !== "saved") throw new Error("second plan should save");

    expect(second.removedFilePaths).toEqual([".data/generated-images/old.png"]);
    expect(await images.findById(article.id, oldFrameId)).toBeNull();
    const genRow = db.prepare("SELECT COUNT(*) AS count FROM image_asset_generations WHERE id = 'gen-old'")
      .get() as unknown as { count: number };
    expect(genRow.count).toBe(0);
    const newSegments = second.article.planning.storyboardSegments ?? [];
    expect(newSegments).toHaveLength(1);
    expect(newSegments[0]?.id).toBe("segment-new");
  });

  it("refuses to redesign while a storyboard frame is generating", async () => {
    const { images, article } = await createFixture();
    const first = await images.applyStoryboardPlan(article.id, article.updatedAt, [
      segmentPlan({ id: "segment-1" })
    ]);
    if (first.kind !== "saved") throw new Error("first plan should save");
    const frameId = (first.article.planning.storyboardSegments ?? [])[0]?.frameAssetIds[0];
    if (!frameId) throw new Error("frame should exist");
    const begun = await images.beginGeneration(article.id, frameId, first.article.updatedAt);
    if (begun.kind !== "saved") throw new Error("begin should save");

    const result = await images.applyStoryboardPlan(article.id, begun.article.updatedAt, [
      segmentPlan({ id: "segment-2" })
    ]);

    expect(result).toMatchObject({
      kind: "invalid_state",
      message: "有分镜图正在生成，请等生成结束或失败后再重新设计分镜；若长时间未动，可先在配图步骤点该帧的「取消生成并恢复占位图」"
    });
  });

  it("rejects empty designs and stale lock tokens", async () => {
    const { images, article } = await createFixture();

    const empty = await images.applyStoryboardPlan(article.id, article.updatedAt, []);
    expect(empty).toMatchObject({ kind: "invalid_state" });

    const stale = await images.applyStoryboardPlan(article.id, "2026-01-01T00:00:00.000Z", [
      segmentPlan()
    ]);
    expect(stale).toEqual({ kind: "conflict" });
  });
});
