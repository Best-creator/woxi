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
    consumedContent: null,
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

  it("references the public CDN url once an image is generated, falling back to the content route", () => {
    const generated = mergeImageBlocks(
      twoBlocks(),
      [asset({ status: "generated", publicUrl: "https://cdn.example.test/a.png" })]
    );
    expect(generated.find((block) => block.type === "image")?.content).toBe(
      "https://cdn.example.test/a.png"
    );

    const placeholder = mergeImageBlocks(twoBlocks(), [asset()]);
    expect(placeholder.find((block) => block.type === "image")?.content).toBe(
      "/api/image-assets/asset-1/content"
    );
  });

  it("renders only the latest cover when multiple cover assets exist", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({
        id: "cover-old",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-16T00:00:00.000Z"
      }),
      asset({
        id: "cover-new",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-17T00:00:00.000Z"
      })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("cover-new");
  });

  it("renders only the latest frame per anchor and type", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({ id: "frame-old", createdAt: "2026-09-16T00:00:00.000Z" }),
      asset({ id: "frame-new", createdAt: "2026-09-17T00:00:00.000Z" })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("frame-new");
  });

  it("keeps assets of different types at the same anchor (dedupe only within the same slot)", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({ id: "frame-storyboard", type: "storyboard" }),
      asset({ id: "frame-concept", type: "concept" })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks.map((block) => block.assetId).sort()).toEqual([
      "frame-concept",
      "frame-storyboard"
    ]);
  });

  it("falls back to the older version when the latest one is disabled", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({
        id: "cover-old",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-16T00:00:00.000Z"
      }),
      asset({
        id: "cover-new",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-17T00:00:00.000Z",
        status: "disabled"
      })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("cover-old");
  });

  it("breaks a createdAt tie deterministically by id", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({ id: "frame-a" }),
      asset({ id: "frame-b" })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("frame-b");
  });

  it("keeps a manually edited asset over a newer automatic one in the same slot", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({ id: "frame-manual", createdAt: "2026-09-16T00:00:00.000Z", manuallyEdited: true }),
      asset({ id: "frame-newer", createdAt: "2026-09-17T00:00:00.000Z" })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("frame-manual");
  });

  it("picks the latest among multiple manually edited versions", () => {
    const blocks = mergeImageBlocks(twoBlocks(), [
      asset({
        id: "cover-manual-old",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-16T00:00:00.000Z",
        manuallyEdited: true
      }),
      asset({
        id: "cover-manual-new",
        type: "cover",
        anchorBlockId: null,
        aspectRatio: "cover",
        createdAt: "2026-09-17T00:00:00.000Z",
        manuallyEdited: true
      })
    ]);

    const imageBlocks = blocks.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.assetId).toBe("cover-manual-new");
  });
});
