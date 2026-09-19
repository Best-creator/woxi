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

function frame(
  id: string,
  status: ImageAsset["status"] = "placeholder",
  overrides: Partial<ImageAsset> = {}
): ImageAsset {
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
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides
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
  withUpdateAsset?: boolean;
} = {}) {
  const withGeneration = overrides.withGeneration ?? true;
  const withUpdateAsset = overrides.withUpdateAsset ?? true;
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
      : undefined,
    updateAsset: withUpdateAsset
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

  it("generates a single frame with the article-level version token", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "生成" }));

    // 乐观锁是文章级的：即使帧的 updated_at 与文章不同步（失败/部分批量后必然漂移），
    // 令牌也必须取 article.updatedAt，否则必撞 409。
    expect(props.generateImage).toHaveBeenCalledWith("frame-2", articleFixture().updatedAt);
    expect(props.onResult).toHaveBeenCalled();
  });

  it("unsticks a generating frame instead of offering another generation", async () => {
    const props = setup({
      assets: [frame("frame-1", "generating"), frame("frame-2", "placeholder"), frame("frame-3", "failed")]
    });

    // generating 的帧只给解卡入口；「生成中」徽章说明它不再叠加生成按钮。
    expect(screen.getByText("生成中")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /取消并恢复占位/ }));

    expect(props.refreshPlaceholder).toHaveBeenCalledWith("frame-1", articleFixture().updatedAt);
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

  it("edits a frame caption inline and saves with the article-level token", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段帧 1 图注" }));

    const input = screen.getByLabelText("第 1 段帧 1 图注");
    expect(input).toHaveValue("分镜帧 frame-1");
    await userEvent.clear(input);
    await userEvent.type(input, "袋熊在斜坡上垒方砖");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 图注走同一个 PATCH（服务端会把它同步进正文图块，公众号图注/导出 PDF 立即生效），
    // 乐观锁与其他写操作一致取文章令牌。
    expect(props.updateAsset).toHaveBeenCalledWith("frame-1", {
      altText: "袋熊在斜坡上垒方砖",
      expectedUpdatedAt: articleFixture().updatedAt
    });
    expect(props.onResult).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("第 1 段帧 1 图注")).toBeNull());
  });

  it("refuses to save an emptied caption", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段帧 1 图注" }));
    await userEvent.clear(screen.getByLabelText("第 1 段帧 1 图注"));

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("shows captions as plain text when editing is not wired", () => {
    setup({ withUpdateAsset: false });

    expect(screen.getByText("分镜帧 frame-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑第 \d+ 段帧 \d+ 图注/ })).toBeNull();
  });
});

describe("SegmentFramesPanel 帧台词条", () => {
  /** frame-1 带一条旁白，其余帧无台词：覆盖展示 / 编辑 / 添加三种分支。 */
  function speechSetup() {
    return setup({
      assets: [
        frame("frame-1", "generated", { speechLine: { kind: "narration", text: "饭量越大干劲越足" } }),
        frame("frame-2"),
        frame("frame-3")
      ]
    });
  }

  it("shows an existing speech line with its kind badge and add entries for bare frames", () => {
    speechSetup();

    expect(screen.getByText("旁白")).toBeInTheDocument();
    expect(screen.getByText("饭量越大干劲越足")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "给第 1 段帧 2 加台词" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "给第 2 段帧 1 加台词" })).toBeInTheDocument();
  });

  it("hides speech editing entries when updating is not wired", () => {
    setup({
      withUpdateAsset: false,
      assets: [
        frame("frame-1", "generated", { speechLine: { kind: "dialogue", text: "干饭去喽" } }),
        frame("frame-2"),
        frame("frame-3")
      ]
    });

    expect(screen.getByText("干饭去喽")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑第 \d+ 段帧 \d+ 台词/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /加台词/ })).toBeNull();
  });

  it("edits a speech line inline choosing kind and text", async () => {
    const props = speechSetup();

    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段帧 1 台词" }));

    const input = screen.getByLabelText("第 1 段帧 1 台词");
    expect(input).toHaveValue("饭量越大干劲越足");
    await userEvent.selectOptions(screen.getByLabelText("第 1 段帧 1 台词类型"), "dialogue");
    await userEvent.clear(input);
    await userEvent.type(input, "干饭去喽！");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 台词走同一个 PATCH；改台词后重新拼接，段图上的台词条随之更新。
    expect(props.updateAsset).toHaveBeenCalledWith("frame-1", {
      speechLine: { kind: "dialogue", text: "干饭去喽！" },
      expectedUpdatedAt: articleFixture().updatedAt
    });
    expect(props.onResult).toHaveBeenCalled();
  });

  it("clears a speech line by saving an emptied text as null", async () => {
    const props = speechSetup();

    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 段帧 1 台词" }));
    await userEvent.clear(screen.getByLabelText("第 1 段帧 1 台词"));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 与图注不同：清空 = 删除台词条（speechLine: null），保存按钮不因空文本被禁。
    expect(props.updateAsset).toHaveBeenCalledWith("frame-1", {
      speechLine: null,
      expectedUpdatedAt: articleFixture().updatedAt
    });
  });

  it("adds a speech line to a frame that has none, defaulting to dialogue", async () => {
    const props = speechSetup();

    await userEvent.click(screen.getByRole("button", { name: "给第 1 段帧 2 加台词" }));

    expect(screen.getByLabelText("第 1 段帧 2 台词类型")).toHaveValue("dialogue");
    await userEvent.type(screen.getByLabelText("第 1 段帧 2 台词"), "冲呀！");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(props.updateAsset).toHaveBeenCalledWith("frame-2", {
      speechLine: { kind: "dialogue", text: "冲呀！" },
      expectedUpdatedAt: articleFixture().updatedAt
    });
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

    expect(props.selectGeneration).toHaveBeenCalledWith("frame-1", "gen-1", articleFixture().updatedAt);
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
