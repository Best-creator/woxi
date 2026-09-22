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
    filePath: "C:/tmp/strip-1.png",
    // 段图归属哪个段靠快照里带 segmentId 的块认出来（拼接时就是这么存的）。
    consumedContent: {
      blocks: BLOCKS.filter((block) => block.segmentId === "seg-1").map((block) => ({ ...block })),
      resumeBeforeBlockId: "s2-h"
    }
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
  const view = render(<SegmentStripsControl {...props} />);
  return { ...props, unmount: view.unmount };
}

describe("SegmentStripsControl", () => {
  it("enables composing once every designed frame has a real image", async () => {
    const props = setup();

    expect(screen.getByRole("status")).toHaveTextContent("已就绪 3 段");
    const button = screen.getByRole("button", { name: "拼接段图" });
    expect(button).toBeEnabled();

    await userEvent.click(button);
    // 缺省字体与文字大小随请求提交（后端校验全过才持久化）。
    expect(props.composeSegmentStrips).toHaveBeenCalledWith(
      articleFixture().updatedAt,
      "sans_default",
      "px-17"
    );
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

    expect(props.composeSegmentStrips).toHaveBeenCalledWith(
      articleFixture().updatedAt,
      "yahei",
      "px-17"
    );
  });

  it("initializes the font dropdown from the persisted planning choice", () => {
    const planning = {
      ...segmentArticle().planning,
      storyboardFontId: "kaiti"
    };
    setup({ article: segmentArticle({ planning }) });

    expect(screen.getByLabelText("段图字体")).toHaveValue("kaiti");
  });

  it("sends the selected text size with the compose request", async () => {
    const props = setup();

    // 档位直接以手机观感 px 命名（2026-09-21 用户拍板），选大档就是 20px。
    await userEvent.selectOptions(screen.getByLabelText("文字大小"), "px-20");
    await userEvent.click(screen.getByRole("button", { name: "拼接段图" }));

    expect(props.composeSegmentStrips).toHaveBeenCalledWith(
      articleFixture().updatedAt,
      "sans_default",
      "px-20"
    );
  });

  it("initializes the text size dropdown from the persisted planning choice", () => {
    // 旧档位 id（compact）经兼容映射落到新 px 档下拉上。
    const planning = {
      ...segmentArticle().planning,
      storyboardTextScaleId: "compact"
    };
    setup({ article: segmentArticle({ planning }) });

    expect(screen.getByLabelText("文字大小")).toHaveValue("px-14");
  });

  it("spells out what each text size looks like on a phone", () => {
    // 档位名已经是 px 值，说明行只补充「这一档和其他档比」的取舍信息。
    setup();

    expect(screen.getByText("与微信正文同大（推荐）")).toBeInTheDocument();
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
    expect(statuses).toContain("文字「17px」");
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
    expect(screen.getByLabelText("文字大小")).toBeDisabled();
  });

  it("shows a stage badge instead of making authors read the whole sentence", () => {
    const view = setup();
    expect(screen.getByText("可以拼接")).toBeInTheDocument();
    view.unmount();

    setup({
      assets: [frame("frame-1", "placeholder"), frame("frame-2a"), frame("frame-2b"), frame("frame-3")]
    });
    expect(screen.getByText("待补 1 帧")).toBeInTheDocument();
  });

  it("lists every segment with its frame progress", () => {
    setup({ assets: [frame("frame-1"), frame("frame-2a", "placeholder"), frame("frame-2b"), frame("frame-3")] });

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("开场");
    expect(rows[0]).toHaveTextContent("帧 1/1");
    expect(rows[0]).toHaveTextContent("文案就绪");
    // 段二缺一帧：进度与状态标签同步反映，不用去数按钮为什么是灰的。
    expect(rows[1]).toHaveTextContent("帧 1/2");
    expect(rows[1]).toHaveTextContent("待补齐");
    expect(screen.getByText("2/3 段就绪")).toBeInTheDocument();
  });

  it("previews the composed strip next to its segment once composed", () => {
    setup({
      assets: [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3"), stripAsset()]
    });

    expect(screen.getByText("已拼接 1 段")).toBeInTheDocument();
    expect(screen.getByAltText("分镜帧 frame-1")).toBeInTheDocument();
    // 只剩没拼的段还挂着「待拼接」标签。
    expect(screen.getAllByText("待拼接")).toHaveLength(2);
  });

  it("renders the sample text in the chosen font so the pick is visible before composing", async () => {
    setup();

    const sample = () => screen.getByText("文案烘进图里的样子");
    expect(sample().getAttribute("style")).toContain("PingFang SC");

    await userEvent.selectOptions(screen.getByLabelText("段图字体"), "kaiti");
    expect(sample().getAttribute("style")).toContain("KaiTi");
  });

  it("stops promising a future compose once strips are already in the body", () => {
    setup({
      assets: [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3"), stripAsset()],
      article: segmentArticle({
        planning: { ...segmentArticle().planning, storyboardTextScaleId: "standard" }
      })
    });

    // 拼过之后再说「将拼成 N 张段图」会读成「还没拼」，语义要跟着状态走。
    expect(screen.getByRole("status")).toHaveTextContent(
      "重新拼接会按当前文案与所选字体、文字大小重出一遍"
    );
  });

  it("tells the author that existing strips were baked with the old small font", () => {
    // 旧段图是像素，字号烘进去就改不了。planning 里没有档位记录 = 这批图出自旧渲染器
    // （手机上只有约 10px），唯一出路是重拼——不点名这句，作者会以为换字号不用重拼。
    setup({
      assets: [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3"), stripAsset()]
    });

    expect(screen.getByRole("status")).toHaveTextContent("它们用的是旧字号");
    expect(screen.getByRole("button", { name: "重新拼接段图" })).toBeEnabled();
  });
});
