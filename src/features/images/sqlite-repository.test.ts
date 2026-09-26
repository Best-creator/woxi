// @vitest-environment node

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { contentBlockSchema } from "@/features/articles/schemas";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import { migrateDatabase } from "@/server/db";
import { imageBlock, twoBlocks } from "../../../tests/fixtures/article";
import { createTestDatabase } from "../../../tests/helpers/test-db";

const cover: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "概览文章主题",
  prompt: "机会成本的清晰中文信息图",
  altText: "机会成本概览图",
  aspectRatio: "cover"
};

const concept: ImagePlanSuggestion = {
  type: "concept",
  anchorBlockId: "block-paragraph-1",
  purpose: "解释取舍关系",
  prompt: "机会成本取舍关系的清晰中文信息图",
  altText: "机会成本取舍关系图",
  aspectRatio: "landscape"
};

async function createArticleWithBlocks() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const images = new SqliteImageAssetRepository(db);
  const article = await articles.create({ topic: "机会成本" });
  article.blocks = twoBlocks();
  const saved = await articles.save(article, article.updatedAt);
  if (saved.kind !== "saved") throw new Error("fixture article should save");
  return { db, articles, images, article: saved.article };
}

describe("image asset contracts", () => {
  it("round-trips image asset references through the article block schema", () => {
    const parsed = contentBlockSchema.parse({
      ...imageBlock(),
      altText: "机会成本概览图"
    });

    expect(parsed.assetId).toBe("asset-1");
  });

  it("migrates repeatedly, isolates articles, round-trips manual edits, and cascades deletion", async () => {
    const { db, articles, images, article } = await createArticleWithBlocks();
    migrateDatabase(db);
    migrateDatabase(db);
    const other = await articles.create({ topic: "沉没成本" });

    const planned = await images.applyPlan(article.id, article.updatedAt, [cover, concept]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const conceptAsset = planned.assets.find((asset) => asset.type === "concept");
    if (!conceptAsset) throw new Error("concept asset should exist");

    const updated = await images.update(article.id, conceptAsset.id, planned.article.updatedAt, {
      prompt: "人工修改后的提示词"
    });
    if (updated.kind !== "saved") throw new Error("asset should update");

    expect((await images.list(other.id))).toEqual([]);
    expect((await images.findById(article.id, conceptAsset.id))?.manuallyEdited).toBe(true);
    expect(await images.findById(other.id, conceptAsset.id)).toBeNull();

    db.prepare("DELETE FROM articles WHERE id = ?").run(article.id);
    expect(await images.list(article.id)).toEqual([]);
  });

  it("replaces automatic placeholders and atomically places cover and anchored image blocks", async () => {
    const { articles, images, article } = await createArticleWithBlocks();

    const first = await images.applyPlan(article.id, article.updatedAt, [cover, concept]);
    if (first.kind !== "saved") throw new Error("first plan should save");
    const replacement = await images.applyPlan(article.id, first.article.updatedAt, [cover]);
    if (replacement.kind !== "saved") throw new Error("replacement plan should save");

    expect(replacement.assets).toHaveLength(1);
    expect(replacement.article.blocks.map((block) => block.type)).toEqual([
      "image",
      "paragraph",
      "paragraph"
    ]);
    expect(replacement.article.blocks[0]).toMatchObject({
      assetId: replacement.assets[0]?.id,
      content: `/api/image-assets/${replacement.assets[0]?.id}/content`,
      altText: "机会成本概览图",
      order: 0,
      version: 1
    });
    expect(replacement.assets[0]).toMatchObject({
      status: "placeholder",
      placeholderUrl: `/api/image-assets/${replacement.assets[0]?.id}/content`,
      manuallyEdited: false
    });
    expect(replacement.article.blocks.map((block) => block.order)).toEqual([0, 1, 2]);
    expect((await images.findById(article.id, replacement.assets[0]?.id ?? ""))?.id).toBe(
      replacement.assets[0]?.id
    );
    expect((await articles.findById(article.id))?.blocks[0]?.assetId).toBe(
      replacement.assets[0]?.id
    );
  });

  it("returns planning metadata from image mutation article snapshots", async () => {
    const { articles, images, article } = await createArticleWithBlocks();
    const saved = await articles.save(
      {
        ...article,
        planning: {
          lengthPreset: "deep",
          recommendedTotalWords: 1800,
          confirmedOutlineRevisionId: "outline-revision-1",
          contentOutlineRevisionId: null
        }
      },
      article.updatedAt
    );
    if (saved.kind !== "saved") throw new Error("planning fixture should save");

    const planned = await images.applyPlan(
      saved.article.id,
      saved.article.updatedAt,
      [cover]
    );

    expect(planned).toMatchObject({
      kind: "saved",
      article: {
        planning: {
          lengthPreset: "deep",
          recommendedTotalWords: 1800,
          confirmedOutlineRevisionId: "outline-revision-1",
          contentOutlineRevisionId: null
        }
      }
    });
  });

  it("rejects an invalid anchor without writing an asset or image block", async () => {
    const { images, article } = await createArticleWithBlocks();
    const invalid = { ...concept, anchorBlockId: "missing-block" };

    const result = await images.applyPlan(article.id, article.updatedAt, [invalid]);

    expect(result).toEqual({ kind: "invalid_anchor", anchorBlockId: "missing-block" });
    expect(await images.list(article.id)).toEqual([]);
  });

  it("rejects a cover carrying an anchor without writing partial plan data", async () => {
    const { images, article } = await createArticleWithBlocks();
    const malformedCover = {
      ...cover,
      anchorBlockId: "block-paragraph-1"
    } as unknown as ImagePlanSuggestion;

    const result = await images.applyPlan(article.id, article.updatedAt, [malformedCover]);

    expect(result).toMatchObject({ kind: "invalid_state" });
    expect(await images.list(article.id)).toEqual([]);
  });

  it("keeps legacy and unknown image blocks while replacing managed image references", async () => {
    const { articles, images, article } = await createArticleWithBlocks();
    article.blocks = [
      {
        id: "legacy-image",
        type: "image",
        content: "/legacy-image.svg",
        altText: "旧版图片",
        order: 0,
        version: 1
      },
      {
        id: "unknown-image",
        type: "image",
        content: "/unknown-image.svg",
        altText: "未知资产图片",
        assetId: "asset-from-another-system",
        order: 1,
        version: 1
      },
      ...article.blocks.map((block) => ({ ...block, order: block.order + 2 }))
    ];
    const saved = await articles.save(article, article.updatedAt);
    if (saved.kind !== "saved") throw new Error("legacy fixture should save");

    const planned = await images.applyPlan(article.id, saved.article.updatedAt, [concept]);
    if (planned.kind !== "saved") throw new Error("plan should save");

    expect(
      planned.article.blocks
        .filter((block) => block.type === "image")
        .map((block) => ({ id: block.id, content: block.content, assetId: block.assetId }))
    ).toEqual([
      { id: "legacy-image", content: "/legacy-image.svg", assetId: undefined },
      {
        id: "unknown-image",
        content: "/unknown-image.svg",
        assetId: "asset-from-another-system"
      },
      {
        id: expect.any(String),
        content: `/api/image-assets/${planned.assets[0]?.id}/content`,
        assetId: planned.assets[0]?.id
      }
    ]);
  });

  it("keeps same-anchor image blocks in plan order after metadata edits", async () => {
    const { images, article } = await createArticleWithBlocks();
    const first = { ...concept, type: "process" as const, altText: "第一张" };
    const second = { ...concept, type: "comparison" as const, altText: "第二张" };

    const planned = await images.applyPlan(article.id, article.updatedAt, [first, second]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const firstAsset = planned.assets.find((asset) => asset.altText === "第一张");
    if (!firstAsset) throw new Error("first asset should exist");
    const edited = await images.update(article.id, firstAsset.id, planned.article.updatedAt, {
      altText: "第一张（已编辑）"
    });
    if (edited.kind !== "saved") throw new Error("edit should save");

    expect(
      edited.article.blocks
        .filter((block) => block.assetId)
        .map((block) => block.altText)
    ).toEqual(["第一张（已编辑）", "第二张"]);
  });

  it("rejects plans over twelve images without replacing existing assets or blocks", async () => {
    const { articles, images, article } = await createArticleWithBlocks();
    const initial = await images.applyPlan(article.id, article.updatedAt, [concept]);
    if (initial.kind !== "saved") throw new Error("initial plan should save");
    const oversized = Array.from({ length: 13 }, (_, index) => ({
      ...concept,
      purpose: `图 ${index + 1}`,
      prompt: `机会成本图 ${index + 1}`,
      altText: `图片 ${index + 1}`
    }));

    const result = await images.applyPlan(article.id, initial.article.updatedAt, oversized);

    expect(result).toMatchObject({ kind: "invalid_plan" });
    expect(await images.list(article.id)).toEqual(initial.assets);
    expect((await articles.findById(article.id))?.blocks).toEqual(initial.article.blocks);
  });

  it("adds and backfills position when migrating an existing image asset table", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE articles (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, status TEXT NOT NULL,
        brief_json TEXT, outline_json TEXT NOT NULL, blocks_json TEXT NOT NULL,
        outline_confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE image_assets (
        id TEXT PRIMARY KEY, article_id TEXT NOT NULL, anchor_block_id TEXT,
        type TEXT NOT NULL, purpose TEXT NOT NULL, prompt TEXT NOT NULL, alt_text TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL, status TEXT NOT NULL, placeholder_url TEXT,
        file_path TEXT, public_url TEXT, manually_edited INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO image_assets (
        id, article_id, anchor_block_id, type, purpose, prompt, alt_text, aspect_ratio,
        status, manually_edited, created_at, updated_at
      ) VALUES
        ('legacy-1', 'article-1', 'block-1', 'concept', 'one', 'one', 'one', 'landscape', 'placeholder', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('legacy-2', 'article-1', 'block-1', 'concept', 'two', 'two', 'two', 'landscape', 'placeholder', 0, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    `);

    migrateDatabase(db);

    const positions = db
      .prepare("SELECT id, position FROM image_assets ORDER BY position ASC")
      .all() as Array<{ id: string; position: number }>;
    expect(positions).toEqual([
      { id: "legacy-1", position: 0 },
      { id: "legacy-2", position: 1 }
    ]);
  });

  it("keeps manual assets across replanning and updates image block state atomically", async () => {
    const { images, article } = await createArticleWithBlocks();
    const planned = await images.applyPlan(article.id, article.updatedAt, [concept]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const asset = planned.assets[0];
    if (!asset) throw new Error("asset should exist");

    const manual = await images.update(article.id, asset.id, planned.article.updatedAt, {
      altText: "人工替代文本"
    });
    if (manual.kind !== "saved") throw new Error("manual update should save");
    const replanned = await images.applyPlan(article.id, manual.article.updatedAt, [cover]);
    if (replanned.kind !== "saved") throw new Error("replan should save");
    const retained = replanned.assets.find((item) => item.id === asset.id);
    if (!retained) throw new Error("manual asset should be retained");

    const disabled = await images.update(article.id, retained.id, replanned.article.updatedAt, {
      enabled: false
    });
    if (disabled.kind !== "saved") throw new Error("disable should save");
    expect(disabled.article.blocks.some((block) => block.assetId === retained.id)).toBe(false);

    const unavailable = await images.refreshPlaceholder(
      article.id,
      retained.id,
      disabled.article.updatedAt
    );
    expect(unavailable).toMatchObject({ kind: "invalid_state" });

    const enabled = await images.update(article.id, retained.id, disabled.article.updatedAt, {
      enabled: true
    });
    if (enabled.kind !== "saved") throw new Error("enable should save");
    expect(enabled.article.blocks.some((block) => block.assetId === retained.id)).toBe(true);

    const stale = await images.remove(article.id, retained.id, disabled.article.updatedAt);
    expect(stale).toEqual({ kind: "conflict" });
    expect((await images.findById(article.id, retained.id))?.status).toBe("placeholder");

    const removed = await images.remove(article.id, retained.id, enabled.article.updatedAt);
    if (removed.kind !== "saved") throw new Error("remove should save");
    expect(removed.article.blocks.some((block) => block.assetId === retained.id)).toBe(false);
    expect(await images.findById(article.id, retained.id)).toBeNull();
  });

  it("disables superseded generated assets on replanning but spares manual edits and comic strips", async () => {
    const { images, article } = await createArticleWithBlocks();

    const first = await images.applyPlan(article.id, article.updatedAt, [cover, concept]);
    if (first.kind !== "saved") throw new Error("first plan should save");
    const conceptAsset = first.assets.find((item) => item.type === "concept");
    if (!conceptAsset) throw new Error("concept asset should exist");

    const begin = await images.beginGeneration(
      article.id,
      conceptAsset.id,
      first.article.updatedAt
    );
    if (begin.kind !== "saved") throw new Error("begin should save");
    const completed = await images.completeGeneration(
      article.id,
      conceptAsset.id,
      begin.article.updatedAt,
      {
        publicUrl: "https://cdn.example.test/frame.png",
        filePath: null,
        generationId: "gen-superseded-1"
      }
    );
    if (completed.kind !== "saved") throw new Error("complete should save");

    const strip = await images.saveComicStrip(article.id, completed.article.updatedAt, {
      assetId: "strip-asset-1",
      generationId: "gen-strip-1",
      mode: "text_image",
      anchorBlockId: "block-paragraph-2",
      consumedContent: {
        blocks: twoBlocks().filter((block) => block.id === "block-paragraph-2"),
        resumeBeforeBlockId: "block-paragraph-2"
      },
      altText: "漫画长图",
      purpose: "漫画长图｜3 格",
      filePath: "strip-1.png"
    });
    if (strip.kind !== "saved") throw new Error("strip should save");

    const replanned = await images.applyPlan(article.id, strip.article.updatedAt, [cover]);
    if (replanned.kind !== "saved") throw new Error("replan should save");

    // 重规划新建的封面（placeholder），与幸存的旧帧、长图并列在全量列表里。
    const freshCovers = replanned.assets.filter(
      (item) => item.type === "cover" && item.status === "placeholder"
    );
    expect(freshCovers).toHaveLength(1);

    const after = await images.list(article.id);
    // 生成过的旧帧被新计划取代：禁用（不是删除），版本历史仍在。
    expect(after.find((item) => item.id === conceptAsset.id)?.status).toBe("disabled");
    // 长图是作者手动拼的：重规划不得碰它。
    expect(after.find((item) => item.id === "strip-asset-1")?.status).toBe("generated");
    // 旧计划的封面（placeholder 未手动）按既有规则直接删除。
    expect(
      after.find((item) => item.type === "cover" && item.id !== freshCovers[0]?.id)
    ).toBeUndefined();
  });
});

describe("image generation state machine", () => {
  it("moves placeholder -> generating -> generated and persists url and file path", async () => {
    const { articles, images, article } = await createArticleWithBlocks();
    const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const asset = planned.assets[0];
    if (!asset) throw new Error("asset should exist");

    const begun = await images.beginGeneration(article.id, asset.id, planned.article.updatedAt);
    if (begun.kind !== "saved") throw new Error("begin should save");
    expect(begun.assets[0]?.status).toBe("generating");
    expect(begun.article.updatedAt).not.toBe(planned.article.updatedAt);

    const staleBegin = await images.beginGeneration(article.id, asset.id, planned.article.updatedAt);
    expect(staleBegin).toEqual({ kind: "conflict" });

    const completed = await images.completeGeneration(article.id, asset.id, begun.article.updatedAt, {
      publicUrl: "https://cdn.example.test/x.png",
      filePath: "C:/tmp/x.png",
      generationId: "generation-1"
    });
    if (completed.kind !== "saved") throw new Error("complete should save");
    expect(completed.assets[0]).toMatchObject({
      status: "generated",
      publicUrl: "https://cdn.example.test/x.png",
      filePath: "C:/tmp/x.png"
    });

    // 生成成功后允许重新生成：generated 状态可以再次 begin。
    const regenerate = await images.beginGeneration(article.id, asset.id, completed.article.updatedAt);
    expect(regenerate.kind).toBe("saved");

    const afterReload = await images.findById(article.id, asset.id);
    expect(afterReload?.filePath).toBe("C:/tmp/x.png");
    void articles;
  });

  it("moves generating -> failed and keeps the placeholder usable", async () => {
    const { images, article } = await createArticleWithBlocks();
    const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const asset = planned.assets[0];
    if (!asset) throw new Error("asset should exist");

    const begun = await images.beginGeneration(article.id, asset.id, planned.article.updatedAt);
    if (begun.kind !== "saved") throw new Error("begin should save");

    const failed = await images.failGeneration(article.id, asset.id, begun.article.updatedAt);
    if (failed.kind !== "saved") throw new Error("fail should save");
    expect(failed.assets[0]?.status).toBe("failed");

    // 失败后可以重试；disabled 后不能生成。
    const retry = await images.beginGeneration(article.id, asset.id, failed.article.updatedAt);
    if (retry.kind !== "saved") throw new Error("retry should save");

    const disabled = await images.update(article.id, asset.id, retry.article.updatedAt, {
      enabled: false
    });
    if (disabled.kind !== "saved") throw new Error("disable should save");
    expect(
      await images.beginGeneration(article.id, asset.id, disabled.article.updatedAt)
    ).toMatchObject({ kind: "invalid_state" });
  });

  it("auto-recovers a zombie generating asset once it exceeds the stale threshold", async () => {
    const { db, articles, images, article } = await createArticleWithBlocks();
    // 阈值 0：任何 generating 在读取时都视为僵死任务（模拟进程重启后的遗留状态）。
    const staleImages = new SqliteImageAssetRepository(db, 0);

    const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const asset = planned.assets[0];
    if (!asset) throw new Error("asset should exist");

    const begun = await images.beginGeneration(article.id, asset.id, planned.article.updatedAt);
    if (begun.kind !== "saved") throw new Error("begin should save");
    // 自愈前重试仍被拒：僵尸 generating 堵死所有推进路径。
    expect(
      await staleImages.beginGeneration(article.id, asset.id, begun.article.updatedAt)
    ).toMatchObject({ kind: "invalid_state", message: "图片正在生成中" });

    // 留出毫秒差，保证 updated_at 严格小于 cutoff。
    await new Promise((resolve) => setTimeout(resolve, 5));

    // 读取即自愈：僵尸 generating 置为 failed，且不推进文章版本。
    const recovered = await staleImages.list(article.id);
    expect(recovered.find((item) => item.id === asset.id)?.status).toBe("failed");
    expect((await articles.findById(article.id))?.updatedAt).toBe(begun.article.updatedAt);

    // 解卡端到端：无需手动恢复即可重新生成。
    expect(
      await images.beginGeneration(article.id, asset.id, begun.article.updatedAt)
    ).toMatchObject({ kind: "saved" });
  });

  it("refuses completion when the asset is not generating", async () => {
    const { images, article } = await createArticleWithBlocks();
    const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const asset = planned.assets[0];
    if (!asset) throw new Error("asset should exist");

    const completed = await images.completeGeneration(
      article.id,
      asset.id,
      planned.article.updatedAt,
      {
        publicUrl: "https://cdn.example.test/x.png",
        filePath: null,
        generationId: "generation-1"
      }
    );
    expect(completed).toMatchObject({ kind: "invalid_state" });
  });
});

async function plannedCover() {
  const { images, article } = await createArticleWithBlocks();
  const planned = await images.applyPlan(article.id, article.updatedAt, [cover]);
  if (planned.kind !== "saved") throw new Error("plan should save");
  return {
    images,
    articleId: article.id,
    assetId: planned.assets[0]!.id,
    updatedAt: planned.article.updatedAt
  };
}

/** 完整走一遍 begin → complete，返回最新的 updatedAt 供下一次生成使用。 */
async function generateVersion(
  fixture: Awaited<ReturnType<typeof plannedCover>>,
  generationId: string,
  publicUrl: string | null,
  filePath: string | null
) {
  const begun = await fixture.images.beginGeneration(
    fixture.articleId,
    fixture.assetId,
    fixture.updatedAt
  );
  if (begun.kind !== "saved") throw new Error("begin should save");
  const completed = await fixture.images.completeGeneration(
    fixture.articleId,
    fixture.assetId,
    begun.article.updatedAt,
    { publicUrl, filePath, generationId }
  );
  if (completed.kind !== "saved") throw new Error("complete should save");
  fixture.updatedAt = completed.article.updatedAt;
  return completed;
}

describe("image generation history", () => {
  it("keeps every version and marks the newest one as selected", async () => {
    const fixture = await plannedCover();
    await generateVersion(fixture, "gen-1", null, "C:/tmp/a-1.png");
    await generateVersion(fixture, "gen-2", null, "C:/tmp/a-2.png");

    const generations = await fixture.images.listGenerationsForAsset(
      fixture.articleId,
      fixture.assetId
    );

    expect(generations).toHaveLength(2);
    // 最新在前：界面第一张就是刚生成的那张。
    expect(generations[0]?.id).toBe("gen-2");
    expect(generations[0]?.selected).toBe(true);
    expect(generations[1]?.selected).toBe(false);
    // 提示词随版本快照，提示词后来被改过也能看出这一版是怎么来的。
    expect(generations[0]?.prompt).toBe(cover.prompt);

    const asset = await fixture.images.findById(fixture.articleId, fixture.assetId);
    expect(asset).toMatchObject({ status: "generated", filePath: "C:/tmp/a-2.png" });
  });

  it("switches the active version and mirrors it onto the asset for downstream consumers", async () => {
    const fixture = await plannedCover();
    await generateVersion(fixture, "gen-1", "https://cdn.test/1.png", "C:/tmp/a-1.png");
    await generateVersion(fixture, "gen-2", "https://cdn.test/2.png", "C:/tmp/a-2.png");

    const result = await fixture.images.selectGeneration(
      fixture.articleId,
      fixture.assetId,
      "gen-1",
      fixture.updatedAt
    );
    if (result.kind !== "saved") throw new Error("select should save");

    // 镜像关系是关键：正文块、content 路由、发布链路读的都是 asset，不是版本表。
    const asset = result.assets.find((candidate) => candidate.id === fixture.assetId);
    expect(asset).toMatchObject({
      status: "generated",
      filePath: "C:/tmp/a-1.png",
      publicUrl: "https://cdn.test/1.png"
    });

    const generations = await fixture.images.listGenerationsForAsset(
      fixture.articleId,
      fixture.assetId
    );
    expect(generations.filter((generation) => generation.selected)).toHaveLength(1);
    expect(generations.find((generation) => generation.selected)?.id).toBe("gen-1");
  });

  it("copies the source version for the cover instead of moving it out of its slot", async () => {
    // 复制语义会真的 copyFileSync，源文件必须存在：临时目录里造一个。
    const storageDir = await mkdtemp(join(tmpdir(), "woxi-cover-copy-"));
    const sourceFile = join(storageDir, "concept-source.png");
    await writeFile(sourceFile, "fake-png-bytes");
    try {
      const { images, article } = await createArticleWithBlocks();
      const planned = await images.applyPlan(article.id, article.updatedAt, [cover, concept]);
      if (planned.kind !== "saved") throw new Error("plan should save");
      const conceptAsset = planned.assets.find((asset) => asset.type === "concept");
      if (!conceptAsset) throw new Error("concept asset should exist");

      const begun = await images.beginGeneration(
        article.id,
        conceptAsset.id,
        planned.article.updatedAt
      );
      if (begun.kind !== "saved") throw new Error("begin should save");
      const completed = await images.completeGeneration(
        article.id,
        conceptAsset.id,
        begun.article.updatedAt,
        {
          publicUrl: "https://cdn.test/concept-1.png",
          filePath: sourceFile,
          generationId: "gen-concept-1"
        }
      );
      if (completed.kind !== "saved") throw new Error("complete should save");

      const coverAsset = completed.assets.find((asset) => asset.type === "cover");
      if (!coverAsset) throw new Error("cover asset should exist");
      const result = await images.selectGeneration(
        article.id,
        coverAsset.id,
        "gen-concept-1",
        completed.article.updatedAt
      );
      if (result.kind !== "saved") throw new Error("select should save");

      // 封面拿到自己的新版本（新 id、独立文件副本）并镜像到资产。
      const coverAfter = result.assets.find((asset) => asset.id === coverAsset.id);
      expect(coverAfter).toMatchObject({
        status: "generated",
        publicUrl: "https://cdn.test/concept-1.png",
        manuallyEdited: true
      });
      expect(coverAfter?.filePath).toBeTruthy();
      expect(coverAfter?.filePath).not.toBe(sourceFile);
      expect(coverAfter?.filePath).toContain(`${coverAsset.id}-`);
      expect(await readFile(coverAfter!.filePath!, "utf8")).toBe("fake-png-bytes");

      const coverVersions = await images.listGenerationsForAsset(article.id, coverAsset.id);
      expect(coverVersions).toHaveLength(1);
      expect(coverVersions[0]!.id).not.toBe("gen-concept-1");
      expect(coverVersions[0]!.selected).toBe(true);
      expect(coverVersions[0]!.publicUrl).toBe("https://cdn.test/concept-1.png");
      expect(coverVersions[0]!.filePath).toBe(coverAfter?.filePath);

      // 回归核心：concept 槽位原封不动——图还在、版本还在、选中标志没被动过。
      const conceptAfter = result.assets.find((asset) => asset.id === conceptAsset.id);
      expect(conceptAfter).toMatchObject({
        status: "generated",
        filePath: sourceFile,
        publicUrl: "https://cdn.test/concept-1.png"
      });
      const conceptVersions = await images.listGenerationsForAsset(article.id, conceptAsset.id);
      expect(conceptVersions).toHaveLength(1);
      expect(conceptVersions[0]!.id).toBe("gen-concept-1");
      expect(conceptVersions[0]!.selected).toBe(true);
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("exposes the whole article library with each version's owning slot", async () => {
    const { images, article } = await createArticleWithBlocks();
    const planned = await images.applyPlan(article.id, article.updatedAt, [cover, concept]);
    if (planned.kind !== "saved") throw new Error("plan should save");
    const coverAsset = planned.assets.find((asset) => asset.type === "cover")!;

    const begun = await images.beginGeneration(article.id, coverAsset.id, planned.article.updatedAt);
    if (begun.kind !== "saved") throw new Error("begin should save");
    const completed = await images.completeGeneration(
      article.id,
      coverAsset.id,
      begun.article.updatedAt,
      { publicUrl: null, filePath: "C:/tmp/cover.png", generationId: "gen-cover" }
    );
    if (completed.kind !== "saved") throw new Error("complete should save");

    const library = await images.listGenerations(article.id);
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      id: "gen-cover",
      assetId: coverAsset.id,
      assetType: "cover",
      assetPurpose: cover.purpose,
      selected: true
    });
  });

  it("falls back to the newest remaining version when the active one is deleted", async () => {
    const fixture = await plannedCover();
    await generateVersion(fixture, "gen-1", null, "C:/tmp/a-1.png");
    await generateVersion(fixture, "gen-2", null, "C:/tmp/a-2.png");

    const result = await fixture.images.deleteGeneration(
      fixture.articleId,
      fixture.assetId,
      "gen-2",
      fixture.updatedAt
    );
    if (result.kind !== "saved") throw new Error("delete should save");

    // 回落到还剩下的那一版，并把它的文件路径镜像回资产；顺带把要删的文件交回给上层。
    expect(result.removedFilePath).toBe("C:/tmp/a-2.png");
    const asset = result.assets.find((candidate) => candidate.id === fixture.assetId);
    expect(asset).toMatchObject({ status: "generated", filePath: "C:/tmp/a-1.png" });

    const generations = await fixture.images.listGenerationsForAsset(
      fixture.articleId,
      fixture.assetId
    );
    expect(generations).toHaveLength(1);
    expect(generations[0]?.selected).toBe(true);
  });

  it("returns the asset to placeholder when its last version is deleted", async () => {
    const fixture = await plannedCover();
    await generateVersion(fixture, "gen-1", null, "C:/tmp/only.png");

    const result = await fixture.images.deleteGeneration(
      fixture.articleId,
      fixture.assetId,
      "gen-1",
      fixture.updatedAt
    );
    if (result.kind !== "saved") throw new Error("delete should save");

    // 不清回 placeholder 的话，资产会继续指向一个已被删掉的文件，前端直接裂图。
    const asset = result.assets.find((candidate) => candidate.id === fixture.assetId);
    expect(asset).toMatchObject({ status: "placeholder", filePath: null, publicUrl: null });
  });

  it("cascades generations away with the asset and keeps them scoped per article", async () => {
    const fixture = await plannedCover();
    await generateVersion(fixture, "gen-1", null, "C:/tmp/a-1.png");

    const removed = await fixture.images.remove(
      fixture.articleId,
      fixture.assetId,
      fixture.updatedAt
    );
    expect(removed.kind).toBe("saved");

    expect(await fixture.images.listGenerations(fixture.articleId)).toEqual([]);
    expect(await fixture.images.findGenerationById("gen-1")).toBeNull();
  });
});
