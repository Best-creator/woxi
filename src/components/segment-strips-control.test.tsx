import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Article, ContentBlock, StoryboardSegment } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { articleFixture } from "../../tests/fixtures/article";
import { SegmentStripsControl } from "./segment-strips-control";

/** 三段覆盖三种排法，与 demo 设计器的形状一致。 */
const SEGMENTS: StoryboardSegment[] = [
  {
    id: "seg-1",
    sectionKey: "sec-1",
    title: "开场",
    route: "image_text",
    copyBlockIds: ["s1-h", "s1-p"],
    frameAssetIds: ["frame-1"],
    order: 0
  },
  {
    id: "seg-2",
    sectionKey: "sec-2",
    title: "机制",
    route: "image_text_image",
    copyBlockIds: ["s2-h", "s2-p"],
    frameAssetIds: ["frame-2a", "frame-2b"],
    order: 1
  },
  {
    id: "seg-3",
    sectionKey: "sec-3",
    title: "收束",
    route: "text_image",
    copyBlockIds: ["s3-h", "s3-p"],
    frameAssetIds: ["frame-3"],
    order: 2
  }
];

const BLOCKS: ContentBlock[] = [
  { id: "s1-h", type: "heading", content: "开场", order: 0, level: 2, segmentId: "seg-1", version: 1 },
  { id: "s1-p", type: "paragraph", content: "第一段文案。", order: 1, segmentId: "seg-1", version: 1 },
  { id: "s2-h", type: "heading", content: "机制", order: 2, level: 2, segmentId: "seg-2", version: 1 },
  { id: "s2-p", type: "paragraph", content: "第二段文案。", order: 3, segmentId: "seg-2", version: 1 },
  { id: "s3-h", type: "heading", content: "收束", order: 4, level: 2, segmentId: "seg-3", version: 1 },
  { id: "s3-p", type: "paragraph", content: "第三段文案。", order: 5, segmentId: "seg-3", version: 1 }
];

function frame(id: string, status: ImageAsset["status"] = "generated"): ImageAsset {
  return {
    id,
    articleId: "article-1",
    type: "storyboard",
    anchorBlockId: null,
    purpose: `分镜 ${id}`,
    prompt: "分镜画面",
    altText: `分镜帧 ${id}`,
    aspectRatio: "square",
    status,
    placeholderUrl: null,
    filePath: status === "generated" ? `C:/tmp/${id}.png` : null,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z"
  };
}

function stripAsset(): ImageAsset {
  return {
    ...frame("frame-1"),
    id: "strip-1",
    type: "comic_strip",
    purpose: "分段长图｜开场｜图 + 文",
    filePath: "C:/tmp/strip-1.png"
  };
}

function segmentArticle(overrides: Partial<Article> = {}): Article {
  return articleFixture({
    planning: {
      lengthPreset: "standard",
      recommendedTotalWords: 1200,
      confirmedOutlineRevisionId: "revision-1",
      contentOutlineRevisionId: "revision-1",
      storyboardSegments: SEGMENTS
    },
    blocks: BLOCKS,
    ...overrides
  });
}

function setup(overrides: {
  article?: Article;
  assets?: ImageAsset[];
  disabled?: boolean;
  composeResult?: unknown;
} = {}) {
  const article = overrides.article ?? segmentArticle();
  const props = {
    article,
    assets: overrides.assets ?? [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3")],
    onResult: vi.fn(),
    composeSegmentStrips: vi.fn().mockResolvedValue(overrides.composeResult ?? {}),
    removeSegmentStrips: vi.fn().mockResolvedValue({}),
    ...(overrides.disabled === undefined ? {} : { disabled: overrides.disabled })
  };
  render(<SegmentStripsControl {...props} />);
  return props;
}

describe("SegmentStripsControl", () => {
  it("enables composing once every designed frame has a real image", async () => {
    const props = setup();

    expect(screen.getByRole("status")).toHaveTextContent("已就绪 3 段");
    const button = screen.getByRole("button", { name: "拼接段图" });
    expect(button).toBeEnabled();

    await userEvent.click(button);
    // 缺省字体随请求提交（后端校验全过才持久化）。
    expect(props.composeSegmentStrips).toHaveBeenCalledWith(articleFixture().updatedAt, "sans_default");
  });

  it("refuses to compose while a frame still has no image", () => {
    const assets = [frame("frame-1", "placeholder"), frame("frame-2a"), frame("frame-2b"), frame("frame-3")];
    setup({ assets });

    expect(screen.getByRole("status")).toHaveTextContent("还有 1 帧分镜没生成图片");
    expect(screen.getByRole("button", { name: "拼接段图" })).toBeDisabled();
  });

  it("also refuses when a route needs more frames than the design provides", () => {
    // 段二是图+文+图但设计上只有 1 帧：拼接会缺帧，按钮同样不放行。
    const article = segmentArticle({
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1200,
        confirmedOutlineRevisionId: "revision-1",
        contentOutlineRevisionId: "revision-1",
        storyboardSegments: SEGMENTS.map((segment) =>
          segment.id === "seg-2"
            ? { ...segment, frameAssetIds: ["frame-2a"] }
            : segment
        )
      }
    });
    setup({ article, assets: [frame("frame-1"), frame("frame-2a"), frame("frame-3")] });

    expect(screen.getByRole("status")).toHaveTextContent("还有 1 帧分镜没生成图片");
    expect(screen.getByRole("button", { name: "拼接段图" })).toBeDisabled();
  });

  it("warns when a segment's copy blocks have disappeared from the body", () => {
    // 正文只剩第一段的块：后两段的成稿文案不在正文里，拼接没有意义。
    setup({ article: segmentArticle({ blocks: BLOCKS.slice(0, 2) }) });

    expect(screen.getByRole("status")).toHaveTextContent("有 2 段的成稿文案不在正文里");
    expect(screen.getByRole("button", { name: "拼接段图" })).toBeDisabled();
  });

  it("sends the selected font with the compose request", async () => {
    const props = setup();

    await userEvent.selectOptions(screen.getByLabelText("段图字体"), "yahei");
    await userEvent.click(screen.getByRole("button", { name: "拼接段图" }));

    expect(props.composeSegmentStrips).toHaveBeenCalledWith(articleFixture().updatedAt, "yahei");
  });

  it("initializes the font dropdown from the persisted planning choice", () => {
    const planning = {
      ...segmentArticle().planning,
      storyboardFontId: "kaiti"
    };
    setup({ article: segmentArticle({ planning }) });

    expect(screen.getByLabelText("段图字体")).toHaveValue("kaiti");
  });

  it("summarizes the compose result with the font label", async () => {
    setup({
      composeResult: {
        strips: [
          { segmentId: "seg-1", title: "开场", route: "image_text", assetId: "a1", width: 800, height: 600, frames: 1 },
          { segmentId: "seg-2", title: "机制", route: "image_text_image", assetId: "a2", width: 800, height: 900, frames: 2 }
        ],
        fontFamily: "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif"
      }
    });

    await userEvent.click(screen.getByRole("button", { name: "拼接段图" }));

    const statuses = screen.getAllByRole("status").map((node) => node.textContent).join("");
    expect(statuses).toContain("已拼接 2 段");
    expect(statuses).toContain("字体「微软雅黑」");
  });

  it("offers re-composing and cancellation once strips exist", async () => {
    const props = setup({
      assets: [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3"), stripAsset()]
    });

    expect(screen.getByRole("button", { name: "重新拼接段图" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消段图" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "取消段图" }));
    // 取消段图复用旧长图的 DELETE：撤本篇全部 comic_strip 并放回正文。
    expect(props.removeSegmentStrips).toHaveBeenCalledWith(articleFixture().updatedAt);
  });

  it("locks everything while the article is being saved", () => {
    setup({ disabled: true });

    expect(screen.getByRole("button", { name: "拼接段图" })).toBeDisabled();
    expect(screen.getByLabelText("段图字体")).toBeDisabled();
  });
});
