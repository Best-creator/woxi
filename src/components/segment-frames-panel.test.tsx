import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article, ContentBlock, StoryboardSegment } from "@/features/articles/domain";
import type { ImageAsset, ImageLibraryItem } from "@/features/images/domain";
import { articleFixture } from "../../tests/fixtures/article";
import { SegmentFramesPanel } from "./segment-frames-panel";

/** 两段覆盖两种排法，帧资产状态各异，覆盖面板的全部按钮分支。 */
const SEGMENTS: StoryboardSegment[] = [
  {
    id: "seg-1",
    sectionKey: "sec-1",
    title: "开场",
    route: "image_text",
    copyBlockIds: ["s1-h", "s1-p"],
    frameAssetIds: ["frame-1", "frame-2"],
    order: 0
  },
  {
    id: "seg-2",
    sectionKey: "sec-2",
    title: "机制",
    route: "text_image",
    copyBlockIds: ["s2-h", "s2-p"],
    frameAssetIds: ["frame-3"],
    order: 1
  }
];

const BLOCKS: ContentBlock[] = [
  { id: "s1-h", type: "heading", content: "开场", order: 0, level: 2, segmentId: "seg-1", version: 1 },
  { id: "s1-p", type: "paragraph", content: "第一段文案。", order: 1, segmentId: "seg-1", version: 1 },
  { id: "s2-h", type: "heading", content: "机制", order: 2, level: 2, segmentId: "seg-2", version: 1 },
  { id: "s2-p", type: "paragraph", content: "第二段文案。", order: 3, segmentId: "seg-2", version: 1 }
];

function frame(id: string, status: ImageAsset["status"] = "placeholder"): ImageAsset {
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
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z"
  };
}

function generation(id: string, assetId: string, overrides: Partial<ImageLibraryItem> = {}): ImageLibraryItem {
  return {
    id,
    articleId: "article-1",
    assetId,
    prompt: `${id} 的画面提示词`,
    model: "demo-model",
    filePath: `C:/tmp/${id}.png`,
    publicUrl: null,
    selected: false,
    createdAt: "2026-09-18T00:00:00.000Z",
    assetType: "storyboard",
    assetPurpose: `分镜 ${assetId}`,
    ...overrides
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
  readOnly?: boolean;
  disabled?: boolean;
  withGeneration?: boolean;
  withSelectGeneration?: boolean;
} = {}) {
  const withGeneration = overrides.withGeneration ?? true;
  const props = {
    article: overrides.article ?? segmentArticle(),
    assets: overrides.assets ?? [
      frame("frame-1", "generated"),
      frame("frame-2", "placeholder"),
      frame("frame-3", "failed")
    ],
    readOnly: overrides.readOnly,
    disabled: overrides.disabled,
    onResult: vi.fn(),
    generateImage: withGeneration
      ? vi.fn().mockResolvedValue({ article: segmentArticle(), assets: [] })
      : undefined,
    generateBatch: withGeneration
      ? vi.fn().mockResolvedValue({ article: segmentArticle(), assets: [] })
      : undefined,
    refreshPlaceholder: vi.fn().mockResolvedValue({ article: segmentArticle(), assets: [] }),
    selectGeneration: overrides.withSelectGeneration
      ? vi.fn().mockResolvedValue({ article: segmentArticle(), assets: [] })
      : undefined
  };
  render(<SegmentFramesPanel {...props} />);
  return props;
}

describe("SegmentFramesPanel", () => {
  it("groups frames by designed segments with route labels and status badges", () => {
    setup();

    expect(screen.getByText("段 1 · 开场")).toBeInTheDocument();
    expect(screen.getByText("段 2 · 机制")).toBeInTheDocument();
    expect(screen.getByText("图 + 文 · 2 帧")).toBeInTheDocument();
    expect(screen.getByText("文 + 图 · 1 帧")).toBeInTheDocument();
    expect(screen.getByText("已生成")).toBeInTheDocument();
    expect(screen.getByText("待生成")).toBeInTheDocument();
    expect(screen.getByText("生成失败")).toBeInTheDocument();
  });

  it("offers per-frame actions matching each frame status", () => {
    setup();

    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试生成" })).toBeInTheDocument();
  });

  it("generates a single frame with the asset's own version token", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "生成" }));

    expect(props.generateImage).toHaveBeenCalledWith("frame-2", "2026-09-18T00:00:00.000Z");
    expect(props.onResult).toHaveBeenCalled();
  });

  it("unsticks a generating frame instead of offering another generation", async () => {
    const props = setup({
      assets: [frame("frame-1", "generating"), frame("frame-2", "placeholder"), frame("frame-3", "failed")]
    });

    // generating 的帧只给解卡入口；「生成中」徽章说明它不再叠加生成按钮。
    expect(screen.getByText("生成中")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /取消并恢复占位/ }));

    expect(props.refreshPlaceholder).toHaveBeenCalledWith("frame-1", "2026-09-18T00:00:00.000Z");
  });

  it("batches all pending frames in one request", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: /一键生成全部待生成帧/ }));

    // 已生成的 frame-1 不在批量范围：只剩占位 + 失败两帧。
    expect(props.generateBatch).toHaveBeenCalledWith({
      expectedUpdatedAt: articleFixture().updatedAt
    });
    expect(screen.getByRole("button", { name: /一键生成全部待生成帧（2）/ })).toBeInTheDocument();
  });

  it("hides the batch entry once every frame has been generated", () => {
    setup({
      assets: [frame("frame-1", "generated"), frame("frame-2", "generated"), frame("frame-3", "generated")]
    });

    expect(screen.queryByRole("button", { name: /一键生成全部待生成帧/ })).toBeNull();
  });

  it("stays view-only when no image generation service is configured", () => {
    setup({ withGeneration: false });

    expect(screen.queryByRole("button", { name: "生成" })).toBeNull();
    expect(screen.queryByRole("button", { name: /一键生成/ })).toBeNull();
    expect(screen.getByText(/未配置生图服务/)).toBeInTheDocument();
  });

  it("locks every action while the article is being saved", () => {
    setup({ disabled: true });

    for (const name of ["重新生成", "生成", "重试生成", /一键生成全部待生成帧/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("renders nothing for articles without storyboard segments", () => {
    const { container } = render(
      <SegmentFramesPanel
        article={articleFixture()}
        assets={[]}
        onResult={vi.fn()}
        refreshPlaceholder={vi.fn().mockResolvedValue({ article: articleFixture(), assets: [] })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("SegmentFramesPanel 帧版本抽屉", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** stub 素材库接口；仓储按 created_at DESC 返回（最新在前）。 */
  function stubGenerations(generations: ImageLibraryItem[]) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ generations })
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("expands a per-frame history drawer with ordered version labels", async () => {
    stubGenerations([generation("gen-2", "frame-1", { selected: true }), generation("gen-1", "frame-1")]);
    setup();

    await screen.findByText("已生成 2 版");

    await userEvent.click(screen.getByRole("button", { name: "已生成 2 版" }));
    expect(screen.getByText("第 2 版 · 当前")).toBeInTheDocument();
    expect(screen.getByText("第 1 版")).toBeInTheDocument();
    expect(screen.getByAltText("gen-1 的画面提示词")).toHaveAttribute(
      "src",
      "/api/image-generations/gen-1/content"
    );

    await userEvent.click(screen.getByRole("button", { name: "已生成 2 版" }));
    expect(screen.queryByText("第 1 版")).toBeNull();
  });

  it("applies an older version through the injected selection callback", async () => {
    stubGenerations([generation("gen-2", "frame-1", { selected: true }), generation("gen-1", "frame-1")]);
    const props = setup({ withSelectGeneration: true });

    await screen.findByText("已生成 2 版");
    await userEvent.click(screen.getByRole("button", { name: "已生成 2 版" }));
    await userEvent.click(screen.getByRole("button", { name: "选用此版" }));

    expect(props.selectGeneration).toHaveBeenCalledWith("frame-1", "gen-1", "2026-09-18T00:00:00.000Z");
    expect(props.onResult).toHaveBeenCalled();
  });

  it("keeps the drawer view-only when selection is not wired", async () => {
    stubGenerations([generation("gen-2", "frame-1", { selected: true }), generation("gen-1", "frame-1")]);
    setup();

    await screen.findByText("已生成 2 版");
    await userEvent.click(screen.getByRole("button", { name: "已生成 2 版" }));

    expect(screen.getByText("第 1 版")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选用此版" })).toBeNull();
  });

  it("hides the drawer entry when the frame has no generation history", async () => {
    const fetchMock = stubGenerations([]);
    setup();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/已生成 \d+ 版/)).toBeNull();
  });

  it("silently ignores a failing generation library fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    setup();

    expect(screen.getByText("段 1 · 开场")).toBeInTheDocument();
    expect(screen.queryByText(/已生成 \d+ 版/)).toBeNull();
  });
});
