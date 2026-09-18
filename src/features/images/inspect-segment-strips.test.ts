import { describe, expect, it } from "vitest";
import type { Article, StoryboardSegment } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import {
  inspectSegmentStrips,
  stripSegmentIdOf
} from "./inspect-segment-strips";

const SEGMENTS: StoryboardSegment[] = [
  {
    id: "seg-1",
    sectionKey: "s1",
    title: "开场",
    route: "image_text",
    copyBlockIds: ["h1", "p1"],
    frameAssetIds: ["f1"],
    order: 0
  },
  {
    id: "seg-2",
    sectionKey: "s2",
    title: "机制",
    route: "image_text_image",
    copyBlockIds: ["h2", "p2"],
    frameAssetIds: ["f2a", "f2b"],
    order: 1
  }
];

const BLOCKS = [
  { id: "h1", type: "heading", content: "开场", order: 0, level: 2, segmentId: "seg-1", version: 1 },
  { id: "p1", type: "paragraph", content: "第一段。", order: 1, segmentId: "seg-1", version: 1 },
  { id: "h2", type: "heading", content: "机制", order: 2, level: 2, segmentId: "seg-2", version: 1 },
  { id: "p2", type: "paragraph", content: "第二段。", order: 3, segmentId: "seg-2", version: 1 }
] as Article["blocks"];

function frame(id: string, status: ImageAsset["status"] = "generated"): ImageAsset {
  return {
    id,
    articleId: "article-1",
    type: "storyboard",
    anchorBlockId: null,
    purpose: `分镜 ${id}`,
    prompt: "分镜画面",
    altText: "分镜",
    aspectRatio: "square",
    status,
    placeholderUrl: null,
    filePath: status === "generated" ? `C:/tmp/${id}.png` : null,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z"
  };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    title: "什么是机会成本",
    topic: "什么是机会成本",
    status: "editing",
    brief: null,
    outline: [],
    blocks: BLOCKS,
    planning: {
      lengthPreset: "standard",
      recommendedTotalWords: 1200,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null,
      storyboardSegments: SEGMENTS
    },
    styleProfile: {} as Article["styleProfile"],
    outlineConfirmedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  };
}

describe("inspectSegmentStrips", () => {
  it("counts zero segments for articles without a design", () => {
    const result = inspectSegmentStrips(article({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: null,
        confirmedOutlineRevisionId: null,
        contentOutlineRevisionId: null
      }
    }), []);

    expect(result).toEqual({
      totalSegments: 0,
      readySegments: 0,
      pendingFrames: 0,
      missingCopySegments: 0,
      segments: []
    });
  });

  it("reports all segments ready when every frame is generated", () => {
    const result = inspectSegmentStrips(article(), [
      frame("f1"),
      frame("f2a"),
      frame("f2b")
    ]);

    expect(result).toMatchObject({
      totalSegments: 2,
      readySegments: 2,
      pendingFrames: 0,
      missingCopySegments: 0
    });
  });

  it("counts placeholder frames and missing assets as pending", () => {
    const result = inspectSegmentStrips(article(), [frame("f1"), frame("f2a", "placeholder")]);

    // 段一缺帧? 不——段一齐了；段二 2 帧里 1 帧待生成、f2b 资产整个缺失 → 差 2。
    expect(result.pendingFrames).toBe(2);
    expect(result.readySegments).toBe(1);
  });

  it("counts a design shortfall as pending even when designed frames are ready", () => {
    // 段二改成图+文+图但设计只给了 1 帧：缺的 1 帧算进 pending，拼接不能放行。
    const result = inspectSegmentStrips(article({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: null,
        contentOutlineRevisionId: null,
        storyboardSegments: SEGMENTS.map((segment) =>
          segment.id === "seg-2" ? { ...segment, frameAssetIds: ["f2a"] } : segment
        )
      }
    }), [frame("f1"), frame("f2a")]);

    expect(result.pendingFrames).toBe(1);
    expect(result.readySegments).toBe(1);
    expect(result.missingCopySegments).toBe(0);
  });

  it("flags segments whose copy blocks are no longer in the body", () => {
    const result = inspectSegmentStrips(article({
      blocks: BLOCKS.filter((block) => block.segmentId === "seg-1")
    }), [frame("f1"), frame("f2a"), frame("f2b")]);

    expect(result.missingCopySegments).toBe(1);
    expect(result.readySegments).toBe(1);
  });

  it("resolves copy blocks on the restored view after strips consumed them", () => {
    // 拼接后文案块从正文消失、只留言图块；判定必须先把快照虚拟放回来。
    const strip = {
      ...frame("strip-1"),
      id: "strip-1",
      type: "comic_strip" as const,
      anchorBlockId: "h1",
      filePath: "C:/tmp/strip.png",
      consumedContent: {
        blocks: BLOCKS.filter((block) => block.segmentId === "seg-1").map((block) => ({ ...block })),
        resumeBeforeBlockId: "h2"
      }
    };
    const bodyAfterCompose = [
      {
        id: "block-strip",
        type: "image" as const,
        content: "/api/image-assets/strip-1/content",
        altText: "段图",
        assetId: "strip-1",
        order: 0,
        version: 1
      },
      ...BLOCKS.filter((block) => block.segmentId === "seg-2")
    ];

    const result = inspectSegmentStrips(article({ blocks: bodyAfterCompose }), [
      frame("f1"),
      frame("f2a"),
      frame("f2b"),
      strip
    ]);

    // 段一的文案在还原视图里找回来了：不算 missing。
    expect(result.missingCopySegments).toBe(0);
    expect(result.readySegments).toBe(2);
  });
});

describe("inspectSegmentStrips 逐段明细", () => {
  it("reports each segment's frame progress and copy state", () => {
    const result = inspectSegmentStrips(article(), [
      frame("f1"),
      frame("f2a", "placeholder"),
      frame("f2b")
    ]);

    expect(result.segments.map((row) => row.segmentId)).toEqual(["seg-1", "seg-2"]);
    expect(result.segments[0]).toMatchObject({
      title: "开场",
      route: "image_text",
      requiredFrames: 1,
      readyFrames: 1,
      hasCopy: true,
      stripAssetId: null
    });
    // 段二 2 帧缺 1：明细与汇总出自同一次判定，不能各说各话。
    expect(result.segments[1]).toMatchObject({ requiredFrames: 2, readyFrames: 1 });
    expect(result.pendingFrames).toBe(1);
  });

  it("points each segment at its composed strip", () => {
    const strip = {
      ...frame("strip-1"),
      id: "strip-1",
      type: "comic_strip" as const,
      filePath: "C:/tmp/strip.png",
      consumedContent: {
        blocks: BLOCKS.filter((block) => block.segmentId === "seg-1").map((block) => ({ ...block })),
        resumeBeforeBlockId: "h2"
      }
    };

    const result = inspectSegmentStrips(article(), [frame("f1"), frame("f2a"), frame("f2b"), strip]);

    expect(result.segments[0]!.stripAssetId).toBe("strip-1");
    expect(result.segments[1]!.stripAssetId).toBeNull();
  });
});

describe("stripSegmentIdOf", () => {
  it("reads the owning segment from the consumed snapshot", () => {
    const strip = {
      ...frame("strip-1"),
      type: "comic_strip" as const,
      consumedContent: {
        blocks: BLOCKS.filter((block) => block.segmentId === "seg-2").map((block) => ({ ...block })),
        resumeBeforeBlockId: null
      }
    };

    expect(stripSegmentIdOf(strip)).toBe("seg-2");
  });

  it("returns null for legacy strips and plain frames", () => {
    // 早年整篇一条的长图没有分段快照，普通配图更谈不上归属。
    const legacy = {
      ...frame("legacy-strip"),
      type: "comic_strip" as const,
      consumedContent: {
        blocks: BLOCKS.map((block) => ({ ...block, segmentId: undefined })),
        resumeBeforeBlockId: null
      }
    };

    expect(stripSegmentIdOf(legacy)).toBeNull();
    expect(stripSegmentIdOf(frame("f1"))).toBeNull();
  });
});
