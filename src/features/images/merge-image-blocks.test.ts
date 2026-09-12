import { describe, expect, it } from "vitest";
import { mergeImageBlocks } from "./merge-image-blocks";
import type { ImageAsset } from "./domain";
import { imageBlock, twoBlocks } from "../../../tests/fixtures/article";

function asset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "asset-1",
    articleId: "article-1",
    type: "concept",
    anchorBlockId: "block-paragraph-1",
    purpose: "解释取舍关系",
    prompt: "机会成本取舍关系图",
    altText: "机会成本取舍关系图",
    aspectRatio: "landscape",
    status: "placeholder",
    placeholderUrl: "/api/image-assets/asset-1/content",
    filePath: null,
    publicUrl: null,
    manuallyEdited: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  };
}

describe("mergeImageBlocks", () => {
  it("places a cover first and anchors inline images after their block", () => {
    const blocks = mergeImageBlocks(
      twoBlocks(),
      [asset({ id: "asset-cover", type: "cover", anchorBlockId: null, aspectRatio: "cover" }), asset()]
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "image",
      "paragraph",
      "image",
      "paragraph"
    ]);
    expect(blocks.map((block) => block.order)).toEqual([0, 1, 2, 3]);
    expect(blocks[0].assetId).toBe("asset-cover");
    expect(blocks[2].assetId).toBe("asset-1");
  });

  it("keeps disabled assets out of the article", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [asset({ status: "disabled" })]);

    expect(blocks.some((block) => block.type === "image")).toBe(false);
  });

  it("drops stale image blocks and renumbers order", () => {
    const blocks = mergeImageBlocks(
      [...twoBlocks(), imageBlock("asset-removed")],
      [asset()],
      ["asset-removed"]
    );

    expect(blocks.filter((block) => block.type === "image")).toHaveLength(1);
    expect(blocks.map((block) => block.order)).toEqual([0, 1, 2]);
  });

  it("ignores assets whose anchor no longer exists", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [asset({ anchorBlockId: "missing-block" })]);

    expect(blocks.some((block) => block.type === "image")).toBe(false);
  });
});
