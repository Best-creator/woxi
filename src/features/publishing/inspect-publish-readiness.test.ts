// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ContentBlock, StoryboardSegment } from "@/features/articles/domain";
import { articleFixture } from "../../../tests/fixtures/article";
import type { ImageAsset } from "@/features/images/domain";
import { inspectPublishReadiness } from "./inspect-publish-readiness";

function copyBlock(
  id: string,
  segmentId: string,
  content: string,
  order: number,
  type: ContentBlock["type"] = "paragraph"
): ContentBlock {
  return { id, type, content, order, version: 1, segmentId };
}

function segment(
  id: string,
  title: string,
  order: number,
  copyBlockIds: string[]
): StoryboardSegment {
  return {
    id,
    sectionKey: `section-${order}`,
    title,
    route: "image_text",
    copyBlockIds,
    frameAssetIds: [],
    order
  };
}

function stripAsset(
  id: string,
  consumedBlocks: ContentBlock[],
  overrides: Partial<ImageAsset> = {}
): ImageAsset {
  return {
    id,
    articleId: "article-1",
    type: "comic_strip",
    anchorBlockId: consumedBlocks[0]?.id ?? null,
    purpose: "分段长图",
    prompt: "prompt",
    altText: "段图",
    aspectRatio: "landscape",
    status: "generated",
    placeholderUrl: null,
    filePath: `.data/${id}.png`,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: { blocks: consumedBlocks, resumeBeforeBlockId: null },
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides
  };
}

function stripImageBlock(assetId: string, order: number): ContentBlock {
  return {
    id: `block-image-${assetId}`,
    type: "image",
    content: `/api/image-assets/${assetId}/content`,
    altText: "段图",
    assetId,
    order,
    version: 1
  };
}

describe("inspectPublishReadiness", () => {
  it("没有分镜段的文章走 legacy 混合路径", () => {
    const article = articleFixture({ blocks: [{ ...copyBlock("c-1", "seg-1", "正文", 0), segmentId: undefined }] });
    const readiness = inspectPublishReadiness(article, []);

    expect(readiness.mode).toBe("legacy");
    expect(readiness.totalSegments).toBe(0);
    expect(readiness.missingStrips).toEqual([]);
  });

  it("全部段已拼段图时缺省全绿，摘要取第一段文案开头（跳过标题块）", () => {
    const seg1Copy = [
      copyBlock("c-1h", "seg-1", "血糖换挡", 0, "heading"),
      copyBlock("c-1p", "seg-1", "血糖塌下去的那段时间，其实是身体在悄悄换挡。", 1)
    ];
    const seg2Copy = [copyBlock("c-2p", "seg-2", "第二天身体就适应了。", 2)];
    const article = articleFixture({
      blocks: [stripImageBlock("strip-1", 0), stripImageBlock("strip-2", 1)],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [
          segment("seg-1", "换挡", 0, ["c-1h", "c-1p"]),
          segment("seg-2", "适应", 1, ["c-2p"])
        ]
      }
    });
    const assets = [
      stripAsset("strip-1", seg1Copy),
      stripAsset("strip-2", seg2Copy)
    ];

    const readiness = inspectPublishReadiness(article, assets);

    expect(readiness.mode).toBe("strip_flow");
    expect(readiness.totalSegments).toBe(2);
    expect(readiness.missingStrips).toEqual([]);
    expect(readiness.residualBlocks).toEqual([]);
    // 摘要取第一段成稿文案（不含标题），且清掉空白
    expect(readiness.suggestedDigest).toBe("血糖塌下去的那段时间，其实是身体在悄悄换挡。");
  });

  it("有段没拼段图时列出到具体段", () => {
    const article = articleFixture({
      blocks: [stripImageBlock("strip-1", 0)],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [
          segment("seg-1", "换挡", 0, ["c-1p"]),
          segment("seg-2", "适应", 1, ["c-2p"])
        ]
      }
    });
    const assets = [
      stripAsset("strip-1", [copyBlock("c-1p", "seg-1", "血糖塌下去了。", 0)])
    ];

    const readiness = inspectPublishReadiness(article, assets);

    expect(readiness.missingStrips).toEqual([{ id: "seg-2", title: "适应" }]);
  });

  it("不属于任何段的残留块会被列出，图片块用 altText 代偿", () => {
    const article = articleFixture({
      blocks: [
        stripImageBlock("strip-1", 0),
        { id: "block-lead", type: "paragraph", content: "作者手加的导语", order: 1, version: 1 },
        {
          id: "block-extra-image",
          type: "image",
          content: "/api/image-assets/concept-9/content",
          altText: "多余的示意图",
          order: 2,
          version: 1
        }
      ],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [segment("seg-1", "换挡", 0, ["c-1p"])]
      }
    });
    const assets = [
      stripAsset("strip-1", [copyBlock("c-1p", "seg-1", "血糖塌下去了。", 0)]),
      {
        ...stripAsset("concept-9", []),
        type: "concept",
        status: "generated",
        consumedContent: null,
        anchorBlockId: null
      } as ImageAsset
    ];

    const readiness = inspectPublishReadiness(article, assets);

    expect(readiness.residualBlocks).toEqual([
      { id: "block-lead", type: "paragraph", content: "作者手加的导语" },
      { id: "block-extra-image", type: "image", content: "多余的示意图" }
    ]);
  });

  it("封面图块不算残留：它是草稿头图，段图流正文里本就不渲染它", () => {
    // 回归用例：封面资产在正文里也有一个 image 块（mergeImageBlocks 把它放在最前）。
    // 段图流渲染只认段图 URL，会把这个块丢掉；发布门要是把它当「残留块」，
    // 每一篇有封面的分镜文章推送时都得先勾一次「强制重新推送」。
    const article = articleFixture({
      blocks: [
        {
          id: "block-cover",
          type: "image",
          content: "/api/image-assets/cover-1/content",
          altText: "封面",
          order: 0,
          version: 1
        },
        stripImageBlock("strip-1", 1)
      ],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [segment("seg-1", "换挡", 0, ["c-1p"])]
      }
    });
    const assets = [
      stripAsset("strip-1", [copyBlock("c-1p", "seg-1", "血糖塌下去了。", 0)]),
      {
        ...stripAsset("cover-1", []),
        type: "cover",
        aspectRatio: "cover",
        consumedContent: null,
        anchorBlockId: null
      } as ImageAsset
    ];

    const readiness = inspectPublishReadiness(article, assets);

    expect(readiness.mode).toBe("strip_flow");
    expect(readiness.missingStrips).toEqual([]);
    expect(readiness.residualBlocks).toEqual([]);
  });

  it("摘要清掉空白并截到 50 字", () => {
    const longCopy = `${"字".repeat(30)}。\n${"词".repeat(40)}。`;
    const article = articleFixture({
      blocks: [stripImageBlock("strip-1", 0)],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [segment("seg-1", "换挡", 0, ["c-1p"])]
      }
    });

    const readiness = inspectPublishReadiness(article, [
      stripAsset("strip-1", [copyBlock("c-1p", "seg-1", longCopy, 0)])
    ]);

    expect(readiness.suggestedDigest).toHaveLength(50);
    expect(readiness.suggestedDigest).not.toContain("\n");
  });

  it("旧单条漫画长图的快照没有 segmentId，不会误判成段图", () => {
    const article = articleFixture({
      blocks: [stripImageBlock("strip-old", 0)],
      planning: {
        ...articleFixture().planning,
        storyboardSegments: [segment("seg-1", "换挡", 0, ["c-1p"])]
      }
    });

    const readiness = inspectPublishReadiness(article, [
      stripAsset("strip-old", [
        { id: "c-1p", type: "paragraph", content: "旧长图快照", order: 0, version: 1 }
      ])
    ]);

    expect(readiness.mode).toBe("strip_flow");
    expect(readiness.missingStrips).toEqual([{ id: "seg-1", title: "换挡" }]);
  });
});
