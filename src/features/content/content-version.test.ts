import { describe, expect, it } from "vitest";
import {
  ContentSnapshotError,
  contentHashInput,
  createContentSnapshot,
  isContentBasedOnCurrentOutline,
  textBlocksOf,
  tryCreateContentSnapshot
} from "./content-version";
import { hashSnapshot } from "@/features/revisions/content-hash";
import { articleFixture, imageBlock, twoBlocks } from "../../../tests/fixtures/article";

describe("createContentSnapshot", () => {
  it("binds the content to the outline revision it was generated from", () => {
    const article = articleFixture({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: "outline-v2",
        contentOutlineRevisionId: "outline-v1"
      },
      blocks: twoBlocks()
    });

    const snapshot = createContentSnapshot(article, "资料快照");

    expect(snapshot.outlineRevisionId).toBe("outline-v1");
    expect(snapshot.recommendedTotalWords).toBe(1200);
    expect(snapshot.sourceContextSnapshot).toBe("资料快照");
    expect(isContentBasedOnCurrentOutline(article)).toBe(false);
  });

  it("reports content as current when it depends on the confirmed outline", () => {
    const article = articleFixture({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: "outline-v2",
        contentOutlineRevisionId: "outline-v2"
      },
      blocks: twoBlocks()
    });

    expect(isContentBasedOnCurrentOutline(article)).toBe(true);
  });

  it("excludes image blocks from the snapshot", () => {
    const article = articleFixture({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: "outline-v1",
        contentOutlineRevisionId: "outline-v1"
      },
      blocks: [...twoBlocks(), imageBlock()]
    });

    const snapshot = createContentSnapshot(article, "");

    expect(snapshot.textBlocks).toHaveLength(2);
    expect(snapshot.textBlocks.every((block) => block.type !== "image")).toBe(true);
  });

  it("rejects articles without confirmed outline, target length or text blocks", () => {
    const noOutline = articleFixture({ blocks: twoBlocks() });
    const noLength = articleFixture({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: null,
        confirmedOutlineRevisionId: "outline-v1",
        contentOutlineRevisionId: "outline-v1"
      },
      blocks: twoBlocks()
    });
    const onlyImages = articleFixture({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: "outline-v1",
        contentOutlineRevisionId: "outline-v1"
      },
      blocks: [imageBlock()]
    });

    expect(() => createContentSnapshot(noOutline, "")).toThrow(ContentSnapshotError);
    expect(() => createContentSnapshot(noLength, "")).toThrow(ContentSnapshotError);
    expect(() => createContentSnapshot(onlyImages, "")).toThrow(ContentSnapshotError);
    expect(tryCreateContentSnapshot(noOutline, "")).toBeNull();
  });
});

describe("content hash", () => {
  const base = articleFixture({
    planning: {
      lengthPreset: "standard",
      recommendedTotalWords: 1200,
      confirmedOutlineRevisionId: "outline-v1",
      contentOutlineRevisionId: "outline-v1"
    },
    blocks: twoBlocks()
  });

  it("ignores image blocks, recommended words and source snapshot", () => {
    const withImages = createContentSnapshot(
      { ...base, blocks: [...twoBlocks(), imageBlock()] },
      "另一份资料"
    );
    const plain = createContentSnapshot(base, "");

    expect(hashSnapshot(contentHashInput(withImages))).toBe(hashSnapshot(contentHashInput(plain)));
  });

  it("changes when the body text or style changes", () => {
    const plain = createContentSnapshot(base, "");
    const retitled = createContentSnapshot({ ...base, title: "换个标题" }, "");
    const restyled = createContentSnapshot(
      { ...base, styleProfile: { ...base.styleProfile, preset: "friend_chat", tone: "亲切、自然、像朋友聊天" } },
      ""
    );

    expect(hashSnapshot(contentHashInput(retitled))).not.toBe(hashSnapshot(contentHashInput(plain)));
    expect(hashSnapshot(contentHashInput(restyled))).not.toBe(hashSnapshot(contentHashInput(plain)));
  });
});

describe("textBlocksOf", () => {
  it("keeps paragraph order contiguous after filtering", () => {
    const blocks = textBlocksOf([
      { id: "a", type: "paragraph", content: "一", order: 3, version: 1 },
      { id: "img", type: "image", content: "/x", order: 1, version: 1 },
      { id: "b", type: "paragraph", content: "二", order: 0, version: 1 }
    ]);

    expect(blocks.map((block) => block.id)).toEqual(["b", "a"]);
    expect(blocks.map((block) => block.order)).toEqual([0, 1]);
  });
});
