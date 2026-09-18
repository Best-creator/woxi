import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset, ImageLibraryItem } from "@/features/images/domain";
import { articleFixture } from "../../tests/fixtures/article";
import { CoverPanel } from "./cover-panel";

function coverAsset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "cover-1",
    articleId: "article-1",
    type: "cover",
    // 封面是公众号头图，永远不挂正文锚点。
    anchorBlockId: null,
    purpose: "封面图",
    prompt: "封面提示词：一张摊开的账本",
    altText: "什么是机会成本 封面",
    aspectRatio: "cover",
    status: "generated",
    placeholderUrl: null,
    filePath: ".data/cover-1.png",
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides
  };
}

function generation(id: string, overrides: Partial<ImageLibraryItem> = {}): ImageLibraryItem {
  return {
    id,
    articleId: "article-1",
    assetId: "strip-1",
    prompt: `${id} 的画面提示词`,
    model: "demo-model",
    filePath: `C:/tmp/${id}.png`,
    publicUrl: null,
    selected: false,
    createdAt: "2026-09-18T00:00:00.000Z",
    assetType: "comic_strip",
    assetPurpose: "分段长图",
    ...overrides
  };
}

/** 面板挂载会拉生图模型目录；素材库只在展开时拉，所以按 URL 分派。 */
function stubApi(options: { models?: Array<{ id: string; provider: string }>; generations?: ImageLibraryItem[] } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/image-models")) {
      return { ok: true, json: async () => ({ models: options.models ?? [], defaultModel: "demo" }) };
    }
    return { ok: true, json: async () => ({ generations: options.generations ?? [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

interface SetupOverrides {
  article?: Article;
  assets?: ImageAsset[];
  readOnly?: boolean;
  disabled?: boolean;
  withGeneration?: boolean;
  withEnsureCover?: boolean;
  withUpdateAsset?: boolean;
  withSelectGeneration?: boolean;
}

function setup(overrides: SetupOverrides = {}) {
  const {
    article = articleFixture(),
    assets = [],
    readOnly = false,
    disabled = false,
    withGeneration = false,
    withEnsureCover = true,
    withUpdateAsset = true,
    withSelectGeneration = false
  } = overrides;
  const payload = { article, assets };
  const props = {
    article,
    assets,
    readOnly,
    disabled,
    onResult: vi.fn(),
    imageGenerationEnabled: withGeneration,
    generateCover: withGeneration ? vi.fn().mockResolvedValue(payload) : undefined,
    ensureCover: withEnsureCover ? vi.fn().mockResolvedValue(payload) : undefined,
    updateAsset: withUpdateAsset ? vi.fn().mockResolvedValue(payload) : undefined,
    selectGeneration: withSelectGeneration ? vi.fn().mockResolvedValue(payload) : undefined
  };
  render(<CoverPanel {...props} />);
  return props;
}

describe("CoverPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("没有封面时给空态与建槽位入口，并把作者写的提示词与比例一起带上", async () => {
    stubApi();
    const props = setup();

    expect(screen.getByText("还没有封面图")).toBeInTheDocument();
    expect(screen.getByText("未创建")).toBeInTheDocument();

    const textarea = screen.getByLabelText("封面提示词") as HTMLTextAreaElement;
    // 没写过就填兜底草稿，保证不是空提示词。
    expect(textarea.value).toContain("什么是机会成本");

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "方图封面：账本与岔路");
    await userEvent.selectOptions(screen.getByLabelText("封面比例"), "square");
    await userEvent.click(screen.getByRole("button", { name: "创建封面槽位" }));

    expect(props.ensureCover).toHaveBeenCalledWith("2026-09-09T00:00:00.000Z", {
      prompt: "方图封面：账本与岔路",
      aspectRatio: "square"
    });
  });

  it("有封面且开了生图时，按当前提示词、比例与所选模型重新生成", async () => {
    stubApi({
      models: [
        { id: "gpt-image-1", provider: "openai" },
        { id: "seedream-4", provider: "volcengine" }
      ]
    });
    const props = setup({ assets: [coverAsset()], withGeneration: true });
    await waitFor(() => expect(screen.getByLabelText("封面生图模型")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText("封面生图模型"), "seedream-4");
    await userEvent.click(screen.getByRole("button", { name: "重新生成封面图" }));

    expect(props.generateCover).toHaveBeenCalledWith({
      prompt: "封面提示词：一张摊开的账本",
      aspectRatio: "cover",
      model: "seedream-4"
    });
  });

  it("提示词失焦落库、比例一改就落库，都带文章级版本号", async () => {
    stubApi();
    const props = setup({ assets: [coverAsset()] });

    const textarea = screen.getByLabelText("封面提示词");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "换一张更有冲击力的封面");
    await userEvent.tab();

    expect(props.updateAsset).toHaveBeenCalledWith("cover-1", {
      prompt: "换一张更有冲击力的封面",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z"
    });

    await userEvent.selectOptions(screen.getByLabelText("封面比例"), "portrait");
    expect(props.updateAsset).toHaveBeenCalledWith("cover-1", {
      aspectRatio: "portrait",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z"
    });
  });

  it("从素材库挑图：列表按需拉取，点一张就把那一版挪到封面槽位", async () => {
    stubApi({ generations: [generation("gen-1"), generation("gen-2")] });
    const props = setup({ assets: [coverAsset()], withSelectGeneration: true });

    expect(screen.queryByText(/正在读取素材库/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "从素材库挑图" }));

    const thumbs = await screen.findAllByRole("button", {
      name: "把这张图挪到封面槽位：分段长图"
    });
    expect(thumbs).toHaveLength(2);
    await userEvent.click(thumbs[0] as HTMLElement);

    expect(props.selectGeneration).toHaveBeenCalledWith(
      "cover-1",
      expect.any(String),
      "2026-09-09T00:00:00.000Z"
    );
  });

  it("只读或保存中时锁住输入与按钮", () => {
    stubApi();
    setup({
      assets: [coverAsset()],
      withGeneration: true,
      withSelectGeneration: true,
      readOnly: true
    });

    expect(screen.getByLabelText("封面提示词")).toBeDisabled();
    expect(screen.getByLabelText("封面比例")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新生成封面图" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "从素材库挑图" })).toBeDisabled();
  });

  it("封面被停用时不给生成按钮，只给一条重新启用的出路", async () => {
    stubApi();
    const props = setup({
      assets: [coverAsset({ status: "disabled" })],
      withGeneration: true
    });

    expect(screen.queryByRole("button", { name: "重新生成封面图" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "启用封面" }));

    expect(props.updateAsset).toHaveBeenCalledWith("cover-1", {
      enabled: true,
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z"
    });
  });

  it("生成失败时把服务端错误显示出来，不让界面静默", async () => {
    stubApi();
    const props = setup({ assets: [coverAsset()], withGeneration: true });
    (props.generateCover as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("生图服务暂时不可用")
    );

    await userEvent.click(screen.getByRole("button", { name: "重新生成封面图" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("生图服务暂时不可用");
  });
});
