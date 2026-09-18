// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteImageAssetRepository } from "@/features/images/sqlite-repository";
import type { ImagePlanSuggestion } from "@/features/images/domain";
import { textBlocksOf } from "./content-version";
import { restoreContentVersion, saveContentVersion } from "./restore-content-version";
import { reviewContent } from "./review-content";
import { articleWithGeneratedContent } from "../../../tests/helpers/content-fixture";

async function contentVersionFixture() {
  const fixture = await articleWithGeneratedContent();
  const firstBlock = textBlocksOf(fixture.article.blocks)[0];
  const suggestion: ImagePlanSuggestion = {
    type: "concept",
    anchorBlockId: firstBlock.id,
    purpose: "解释取舍关系",
    prompt: "机会成本取舍关系图",
    altText: "机会成本取舍关系图",
    aspectRatio: "landscape"
  };
  return { ...fixture, images: new SqliteImageAssetRepository(fixture.db), suggestion };
}

describe("SqliteContentWorkflowRepository", () => {
  it("numbers content versions independently from outline versions", async () => {
    const fixture = await articleWithGeneratedContent();
    const outlineVersions = await fixture.outlineWorkflow.listOutlineVersions(fixture.article.id);
    const contentVersions = await fixture.contentWorkflow.listContentVersions(fixture.article.id);

    expect(outlineVersions.length).toBeGreaterThan(0);
    expect(contentVersions).toHaveLength(1);
    expect(contentVersions[0]).toMatchObject({ scope: "content", version: 1 });
  });

  it("restores an old version as a new version without deleting history", async () => {
    const fixture = await contentVersionFixture();
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: "第二版正文", version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const saved = await fixture.articles.findById(fixture.article.id);
    if (!saved) throw new Error("fixture should persist");
    const second = await saveContentVersion(
      { articleId: saved.id, expectedUpdatedAt: saved.updatedAt, model: "writer-large" },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );
    if (second.kind !== "saved") throw new Error("fixture should save v2");

    const restored = await restoreContentVersion(
      { articleId: saved.id, versionId: fixture.contentRevision.id, expectedUpdatedAt: second.article.updatedAt },
      { workflow: fixture.contentWorkflow }
    );

    expect(restored).toMatchObject({ kind: "restored", revision: { version: 3, reason: "restored" } });
    const versions = await fixture.contentWorkflow.listContentVersions(fixture.article.id);
    expect(versions.map((version) => version.version).sort()).toEqual([1, 2, 3]);
    if (restored.kind !== "restored") throw new Error("expected restored");
    expect(textBlocksOf(restored.article.blocks)[0].content).toBe(
      textBlocksOf(fixture.article.blocks)[0].content
    );
  });

  it("re-merges the current image assets when restoring text", async () => {
    const fixture = await contentVersionFixture();
    const planned = await fixture.images.applyPlan(fixture.article.id, fixture.article.updatedAt, [fixture.suggestion]);
    if (planned.kind !== "saved") throw new Error("fixture should plan images");
    const withImages = await fixture.articles.findById(fixture.article.id);
    if (!withImages) throw new Error("fixture should persist");
    const version = await saveContentVersion(
      { articleId: withImages.id, expectedUpdatedAt: withImages.updatedAt, model: "writer-large" },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );
    if (version.kind !== "saved") throw new Error("fixture should save a version");

    const restored = await restoreContentVersion(
      { articleId: withImages.id, versionId: fixture.contentRevision.id, expectedUpdatedAt: version.article.updatedAt },
      { workflow: fixture.contentWorkflow }
    );

    if (restored.kind !== "restored") throw new Error("expected restored");
    expect(restored.article.blocks.some((block) => block.type === "image")).toBe(true);
    expect(restored.article.blocks.map((block) => block.order)).toEqual(
      restored.article.blocks.map((_, index) => index)
    );
  });

  it("keeps the content hash stable when only image planning changes", async () => {
    const fixture = await contentVersionFixture();
    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      { articles: fixture.articles, sources: fixture.sources, reviewer: fixture.reviewer, workflow: fixture.contentWorkflow }
    );
    const planned = await fixture.images.applyPlan(fixture.article.id, fixture.article.updatedAt, [fixture.suggestion]);
    if (planned.kind !== "saved") throw new Error("fixture should plan images");

    const versions = await fixture.contentWorkflow.listContentVersions(fixture.article.id);

    expect(versions).toHaveLength(1);
  });

  it("re-submits a restored version's storyboard design to step four when its frames are alive", async () => {
    const fixture = await articleWithGeneratedContent();
    const design = fixture.article.planning.storyboardSegments ?? [];
    expect(design.length).toBeGreaterThan(0);

    // 生成版快照只带帧描述符（帧是设计落库之后才创建的）。段 id 未变且帧仍存活，
    // 恢复时按当前 planning 认领绑定，正文版本连同分镜设计重新提交给第四步。
    const restored = await restoreContentVersion(
      { articleId: fixture.article.id, versionId: fixture.contentRevision.id, expectedUpdatedAt: fixture.article.updatedAt },
      { workflow: fixture.contentWorkflow }
    );

    if (restored.kind !== "restored") throw new Error(`expected restored, got ${restored.kind}`);
    expect(restored.revision.reason).toBe("restored");
    expect(restored.article.planning.storyboardSegments?.map((segment) => segment.frameAssetIds)).toEqual(
      design.map((segment) => segment.frameAssetIds)
    );
    // 生成版快照本来就带描述符：帧缺失的将来版本仍可按它重建。
    for (const segment of fixture.contentRevision.snapshot.storyboardSegments ?? []) {
      expect(segment.frames.length).toBeGreaterThan(0);
      for (const frame of segment.frames) {
        expect(frame.prompt.length).toBeGreaterThan(0);
      }
    }
  });

  it("captures frame bindings and descriptors when manually saving a version", async () => {
    const fixture = await articleWithGeneratedContent();
    const design = fixture.article.planning.storyboardSegments ?? [];
    // 改一个字强制产生新版本：内容哈希不变时 saveContentVersion 会去重回生成版。
    const edited = {
      ...fixture.article,
      blocks: fixture.article.blocks.map((block, index) =>
        index === 0 ? { ...block, content: "第二版正文", version: block.version + 1 } : block
      )
    };
    await fixture.articles.save(edited, fixture.article.updatedAt);
    const current = await fixture.articles.findById(fixture.article.id);
    if (!current) throw new Error("fixture should persist");

    const saved = await saveContentVersion(
      { articleId: current.id, expectedUpdatedAt: current.updatedAt, model: "writer-large" },
      { articles: fixture.articles, sources: fixture.sources, workflow: fixture.contentWorkflow }
    );
    if (saved.kind !== "saved") throw new Error("fixture should save a version");

    // 手动快照同时带帧绑定（原样重新提交）与描述符（帧缺失时可重建）。
    const snapshotSegments = saved.revision.snapshot.storyboardSegments ?? [];
    expect(snapshotSegments.map((segment) => segment.frameAssetIds)).toEqual(
      design.map((segment) => segment.frameAssetIds)
    );
    for (const segment of snapshotSegments) {
      expect(segment.frames.length).toBe(segment.frameAssetIds?.length ?? 0);
      for (const frame of segment.frames) {
        expect(frame.prompt.length).toBeGreaterThan(0);
      }
    }
  });

  it("rebuilds placeholder frames from snapshot descriptors when restored frames are gone", async () => {
    const fixture = await articleWithGeneratedContent();
    const versions = await fixture.contentWorkflow.listContentVersions(fixture.article.id);
    const firstSnapshot = versions[0]!.snapshot;
    const firstSegments = firstSnapshot.storyboardSegments;
    expect(firstSegments?.length).toBeGreaterThan(0);

    // 模拟「后来重新设计过分镜」：旧帧全部退役，换成一套全新的帧。
    const firstBlockId = textBlocksOf(fixture.article.blocks)[0]!.id;
    const replanned = await fixture.imageAssets.applyStoryboardPlan(fixture.article.id, fixture.article.updatedAt, [
      {
        id: "reseg-1",
        sectionKey: "resec-1",
        title: "重新设计段",
        route: "image_text",
        copyBlockIds: [firstBlockId],
        frames: [{ prompt: "全新的分镜画面", altText: "全新帧" }]
      }
    ]);
    if (replanned.kind !== "saved") throw new Error("fixture should replan storyboards");

    // 恢复第一版：旧帧已缺失 → 按快照描述符重建占位帧，重新提交给第四步。
    const restored = await restoreContentVersion(
      { articleId: fixture.article.id, versionId: versions[0]!.id, expectedUpdatedAt: replanned.article.updatedAt },
      { workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );

    if (restored.kind !== "restored") throw new Error(`expected restored, got ${restored.kind}`);
    const restoredSegments = restored.article.planning.storyboardSegments ?? [];
    expect(restoredSegments.map((segment) => segment.sectionKey)).toEqual(
      firstSegments!.map((segment) => segment.sectionKey)
    );
    for (const [index, segment] of restoredSegments.entries()) {
      expect(segment.frameAssetIds).toHaveLength(firstSegments![index]!.frames.length);
      for (const [frameIndex, frameAssetId] of segment.frameAssetIds.entries()) {
        const asset = await fixture.imageAssets.findById(fixture.article.id, frameAssetId);
        expect(asset).toMatchObject({
          type: "storyboard",
          status: "placeholder",
          prompt: firstSegments![index]!.frames[frameIndex]!.prompt
        });
      }
    }
    // 重新设计时的帧已随恢复退役。
    for (const oldFrameId of replanned.article.planning.storyboardSegments?.[0]?.frameAssetIds ?? []) {
      expect(await fixture.imageAssets.findById(fixture.article.id, oldFrameId)).toBeNull();
    }
  });

  it("maps restore failures to explicit results", async () => {
    const fixture = await contentVersionFixture();
    const missingVersion = await restoreContentVersion(
      { articleId: fixture.article.id, versionId: "missing", expectedUpdatedAt: fixture.article.updatedAt },
      { workflow: fixture.contentWorkflow }
    );
    const missingArticle = await restoreContentVersion(
      { articleId: "missing", versionId: fixture.contentRevision.id, expectedUpdatedAt: fixture.article.updatedAt },
      { workflow: fixture.contentWorkflow }
    );
    const stale = await restoreContentVersion(
      { articleId: fixture.article.id, versionId: fixture.contentRevision.id, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
      { workflow: fixture.contentWorkflow }
    );

    expect(missingVersion).toEqual({ kind: "version_not_found" });
    expect(missingArticle).toEqual({ kind: "not_found" });
    expect(stale).toEqual({ kind: "conflict" });
  });
});
