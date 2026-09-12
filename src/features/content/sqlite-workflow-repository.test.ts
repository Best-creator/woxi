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
