import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock, StoryboardSegment } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { StoryboardSegmentList } from "./storyboard-segment-list";

/** 三段覆盖三种排法：图+文 / 图+文+图 / 文+图。 */
const BLOCKS: ContentBlock[] = [
  { id: "s1-h", type: "heading", content: "开场", order: 0, level: 2, segmentId: "seg-1", version: 1 },
  { id: "s1-p", type: "paragraph", content: "第一段文案。", order: 1, segmentId: "seg-1", version: 1 },
  { id: "s2-h", type: "heading", content: "机制", order: 2, level: 2, segmentId: "seg-2", version: 1 },
  { id: "s2-p", type: "paragraph", content: "第二段文案。", order: 3, segmentId: "seg-2", version: 1 },
  { id: "s3-h", type: "heading", content: "收束", order: 4, level: 2, segmentId: "seg-3", version: 1 },
  { id: "s3-p", type: "paragraph", content: "第三段文案。", order: 5, segmentId: "seg-3", version: 1 }
];

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

function allFramesGenerated(): ImageAsset[] {
  return [frame("frame-1"), frame("frame-2a"), frame("frame-2b"), frame("frame-3")];
}

function setup(overrides: {
  segments?: StoryboardSegment[];
  blocks?: ContentBlock[];
  imageAssets?: ImageAsset[];
  stripsComposed?: boolean;
  readOnly?: boolean;
} = {}) {
  const props = {
    segments: overrides.segments ?? SEGMENTS,
    blocks: overrides.blocks ?? BLOCKS,
    imageAssets: overrides.imageAssets ?? allFramesGenerated(),
    stripsComposed: overrides.stripsComposed ?? false,
    readOnly: overrides.readOnly ?? false,
    onEditBlocks: vi.fn(),
    onRouteChange: vi.fn()
  };
  render(<StoryboardSegmentList {...props} />);
  return props;
}

describe("StoryboardSegmentList", () => {
  it("renders one card per segment in design order with a route select", () => {
    setup();

    // 卡内文案 textarea 的 textContent 也会是段标题（React 受控 defaultValue），
    // 所以用 heading 角色精确定位卡标题，别用 getByText。
    expect(screen.getByRole("heading", { name: "开场" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "机制" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "收束" })).toBeVisible();

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(3);
    expect(screen.getByLabelText("开场 排法")).toHaveValue("image_text");
    expect(screen.getByLabelText("机制 排法")).toHaveValue("image_text_image");
    expect(screen.getByLabelText("收束 排法")).toHaveValue("text_image");
  });

  it("offers exactly the four storyboard routes in every card", () => {
    setup();

    const select = screen.getByLabelText("开场 排法") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "image_text",
      "text_image",
      "image_text_image",
      "text_only"
    ]);
  });

  it("labels a text-only segment instead of demanding frames", () => {
    // 天生纯文字段（设计期就是 text_only，0 帧）：不能报「还没有分镜帧」。
    setup({
      segments: SEGMENTS.map((segment) =>
        segment.id === "seg-2"
          ? { ...segment, route: "text_only" as const, frameAssetIds: [] }
          : segment
      )
    });

    expect(screen.getByText("纯文字段：不配画面，文案作为普通正文段落排在段图之间")).toBeVisible();
    expect(screen.queryByText("该排法需要 0 帧，当前 2 帧")).not.toBeInTheDocument();
  });

  it("explains dormant frames when a segment is switched to text-only", () => {
    // 两帧段被切成纯文字：帧资产进入休眠（不删），提示切回排法可恢复。
    setup({
      segments: SEGMENTS.map((segment) =>
        segment.id === "seg-2" ? { ...segment, route: "text_only" as const } : segment
      )
    });

    expect(screen.getByText("纯文字段不配画面；切回其他排法可恢复这些帧的占位")).toBeVisible();
  });

  it("reports the route override back through onRouteChange", async () => {
    const props = setup();

    await userEvent.selectOptions(screen.getByLabelText("开场 排法"), "text_image");

    expect(props.onRouteChange).toHaveBeenCalledWith("seg-1", "text_image");
  });

  it("shows generated frames as thumbnails via the content route", () => {
    setup();

    const image = screen.getByAltText("分镜帧 frame-1");
    expect(image).toHaveAttribute("src", "/api/image-assets/frame-1/content");
  });

  it("marks frames without a real image as pending", () => {
    setup({ imageAssets: allFramesGenerated().map((asset, index) => (index === 0 ? frame("frame-1", "placeholder") : asset)) });

    expect(screen.getByText("待生成")).toBeVisible();
    expect(screen.queryByAltText("分镜帧 frame-1")).not.toBeInTheDocument();
  });

  it("warns when the route needs more frames than the design provides", () => {
    // 段一改成图+文+图但只设计了 1 帧：拼接会缺帧，卡片要提前报警。
    setup({
      segments: SEGMENTS.map((segment) =>
        segment.id === "seg-1"
          ? { ...segment, route: "image_text_image" as const }
          : segment
      )
    });

    expect(screen.getByText("该排法需要 2 帧，当前 1 帧")).toBeVisible();
  });

  it("keeps the block numbering globally unique across cards", () => {
    setup();

    // 卡一：标题块 1 / 正文块 1；卡二：标题块 2 / 正文块 2……全页可唯一定位。
    expect(screen.getByLabelText("标题块 1")).toHaveValue("开场");
    expect(screen.getByLabelText("正文块 1")).toHaveValue("第一段文案。");
    expect(screen.getByLabelText("标题块 2")).toHaveValue("机制");
    expect(screen.getByLabelText("正文块 2")).toHaveValue("第二段文案。");
    expect(screen.getByLabelText("标题块 3")).toHaveValue("收束");
    expect(screen.getByLabelText("正文块 3")).toHaveValue("第三段文案。");
  });

  it("merges card edits back into the full block list by id", () => {
    const props = setup();

    // 受控组件没有回写 state，逐键输入会回弹——用一次 change 事件模拟完整编辑。
    fireEvent.change(screen.getByLabelText("正文块 1"), {
      target: { value: "改后的第一段文案。" }
    });

    expect(props.onEditBlocks).toHaveBeenCalledOnce();
    const submitted = props.onEditBlocks.mock.calls[0]![0] as ContentBlock[];
    expect(submitted).toHaveLength(BLOCKS.length);
    expect(submitted.find((block) => block.id === "s1-p")?.content).toBe("改后的第一段文案。");
    // 未被本卡编辑的块原样保留（引用不换、内容不变）。
    expect(submitted.find((block) => block.id === "s2-p")?.content).toBe("第二段文案。");
  });

  it("locks the copy blocks once segment strips are composed", () => {
    setup({ stripsComposed: true });

    // 每张卡都带一条锁定提示。
    expect(screen.getAllByText("已拼接段图，先取消段图再修改文案")).toHaveLength(3);
    for (const textarea of screen.getAllByRole("textbox")) {
      expect(textarea).toBeDisabled();
    }
    // 路由下拉不受段图锁定影响：改排法只动 planning，不碰正文块。
    expect(screen.getByLabelText("开场 排法")).toBeEnabled();
  });
});
