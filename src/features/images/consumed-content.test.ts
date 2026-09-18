import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import { restoreConsumedBlocks, withStripsRestored } from "./consumed-content";

function text(id: string, order: number, segmentId?: string): ContentBlock {
  return { id, type: "paragraph", content: `${id} 的文案`, order, segmentId, version: 1 };
}

function image(id: string, order: number): ContentBlock {
  return {
    id,
    type: "image",
    content: `/api/image-assets/${id}/content`,
    altText: "段图",
    order,
    version: 1
  };
}

function strip(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "strip-1",
    articleId: "article-1",
    type: "comic_strip",
    anchorBlockId: null,
    purpose: "分段长图",
    prompt: "purpose",
    altText: "标题｜段图｜段标题",
    aspectRatio: "portrait",
    status: "generated",
    placeholderUrl: null,
    filePath: "C:/tmp/strip-1.png",
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    ...overrides
  };
}

describe("restoreConsumedBlocks", () => {
  it("puts the consumed blocks back in front of the block that used to follow them", () => {
    const restored = restoreConsumedBlocks([text("b1", 0, "seg-2")], {
      blocks: [text("a1", 0, "seg-1"), text("a2", 1, "seg-1")],
      resumeBeforeBlockId: "b1"
    });

    expect(restored.map((block) => block.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("appends the consumed blocks when the strip swallowed the tail of the body", () => {
    // resumeBeforeBlockId 为 null 是合法语义：本段吃到文末，还原点就是末尾。
    const restored = restoreConsumedBlocks([text("b1", 0, "seg-1")], {
      blocks: [text("a1", 0, "seg-2")],
      resumeBeforeBlockId: null
    });

    expect(restored.map((block) => block.id)).toEqual(["b1", "a1"]);
  });

  it("drops a snapshot from a previous design instead of mixing an old draft into the body", () => {
    // 正文被整篇重新生成后，上一代段图的块带着老设计的段 id：整批放弃还原。
    // 否则就是「段图里一遍、正文里又一遍」，且新段图再也认领不到这些块。
    const restored = restoreConsumedBlocks(
      [text("new-1", 0, "seg-new")],
      {
        blocks: [text("old-1", 0, "seg-old"), text("old-2", 1, "seg-old")],
        resumeBeforeBlockId: "old-next"
      },
      ["seg-new"]
    );

    expect(restored.map((block) => block.id)).toEqual(["new-1"]);
  });

  it("still restores a current-design snapshot whose anchor block was lost", () => {
    // 历史脏锚点（指向上一代块）不能让当前设计的段图连文案一起消失：
    // 恢复版本的两步串联（restoreContent → applyStoryboardRevision）就靠这条顶住——
    // 文案放不回来，mergeImageBlocks 就找不到锚点，段图会跟着一起丢。
    const restored = restoreConsumedBlocks(
      [text("b1", 0, "seg-1")],
      { blocks: [text("a1", 0, "seg-1")], resumeBeforeBlockId: "long-gone" },
      ["seg-1"]
    );

    expect(restored.map((block) => block.id)).toEqual(["b1", "a1"]);
  });

  it("never resurrects image blocks that the merge step already re-inserts", () => {
    const restored = restoreConsumedBlocks([text("b1", 0)], {
      blocks: [image("stale-strip", 0)],
      resumeBeforeBlockId: null
    });

    expect(restored.map((block) => block.id)).toEqual(["b1"]);
  });

  it("leaves blocks that are already in the body untouched", () => {
    const body = [text("a1", 0), text("b1", 1)];
    const restored = restoreConsumedBlocks(body, {
      blocks: [text("a1", 0)],
      resumeBeforeBlockId: "b1"
    });

    expect(restored.map((block) => block.id)).toEqual(["a1", "b1"]);
  });

  it("drops a tail-placed snapshot from a previous design even without an anchor", () => {
    // 最后一段的段图 `resumeBeforeBlockId` 恒为 null；换版后重拼，它的老文案本来会
    // 以「追加到文末」的名义整批溜回正文——段 id 对不上当前设计时必须整批丢弃。
    const restored = restoreConsumedBlocks(
      [text("new-1", 0, "seg-new")],
      {
        blocks: [text("old-1", 0, "seg-old"), text("old-2", 1, "seg-old")],
        resumeBeforeBlockId: null
      },
      ["seg-new"]
    );

    expect(restored.map((block) => block.id)).toEqual(["new-1"]);
  });

  it("keeps a tail-placed snapshot that still belongs to the current design", () => {
    const restored = restoreConsumedBlocks(
      [text("a0", 0, "seg-1")],
      { blocks: [text("a1", 1, "seg-2")], resumeBeforeBlockId: null },
      ["seg-1", "seg-2"]
    );

    expect(restored.map((block) => block.id)).toEqual(["a0", "a1"]);
  });

  it("ignores the segment rule for legacy snapshots that carry no segment ids", () => {
    // 早年文章级长图的快照块没有段 id：只服锚点判据，不能被段 id 规则误伤。
    const legacy = text("legacy", 0);
    delete legacy.segmentId;
    const restored = restoreConsumedBlocks(
      [text("b1", 0)],
      { blocks: [legacy], resumeBeforeBlockId: null },
      ["seg-new"]
    );

    expect(restored.map((block) => block.id)).toEqual(["b1", "legacy"]);
  });

  it("drops a legacy snapshot whose anchor block is gone", () => {
    // 没有段 id 的老长图只能看锚点：锚点块在正文里彻底找不到就是上一代正文的快照。
    const legacy = text("legacy", 0);
    delete legacy.segmentId;
    const restored = restoreConsumedBlocks(
      [text("b1", 0)],
      { blocks: [legacy], resumeBeforeBlockId: "long-gone" },
      ["seg-new"]
    );

    expect(restored.map((block) => block.id)).toEqual(["b1"]);
  });
});

describe("withStripsRestored", () => {
  it("restores the current strips and skips the ones from a previous draft", () => {
    const body = [image("strip-image", 0), text("new-1", 1, "seg-new")];
    const stripped = withStripsRestored(
      body,
      [
        strip({
          id: "strip-old",
          consumedContent: {
            blocks: [text("old-1", 0, "seg-old")],
            resumeBeforeBlockId: "old-next"
          }
        }),
        strip({
          id: "strip-image",
          consumedContent: {
            blocks: [text("new-0", 0, "seg-new")],
            resumeBeforeBlockId: "new-1"
          }
        })
      ],
      ["seg-new"]
    );

    // 当前段图的文案放回来了（界面据此认出「这篇有分镜」），
    // 上一代段图的文案则整批丢弃；图片块由 mergeImageBlocks 在落库时重新插回。
    expect(stripped.map((block) => block.id)).toEqual(["new-0", "new-1"]);
  });
});
