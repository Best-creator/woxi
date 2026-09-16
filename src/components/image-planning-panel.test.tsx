import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { articleFixture, paragraphBlock } from "../../tests/fixtures/article";
import type { ImageAsset, ImageLibraryItem } from "@/features/images/domain";
import { ImagePlanningPanel } from "./image-planning-panel";

function imageAsset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "asset-1",
    articleId: "article-1",
    type: "concept",
    anchorBlockId: "block-paragraph-1",
    purpose: "解释机会成本的核心关系",
    prompt: "清晰的机会成本信息图",
    altText: "机会成本关系图",
    aspectRatio: "landscape",
    status: "placeholder",
    placeholderUrl: "/api/image-assets/asset-1/content",
    filePath: null,
    publicUrl: null,
    manuallyEdited: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  };
}

describe("ImagePlanningPanel", () => {
  it("plans images using the article version and replaces the workspace snapshot", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const plannedArticle = { ...article, updatedAt: "2026-09-09T00:00:01.000Z" };
    const plannedAssets = [imageAsset()];
    const planImages = vi.fn(async () => ({ article: plannedArticle, assets: plannedAssets }));
    const onResult = vi.fn();
    render(
      <ImagePlanningPanel
        article={article}
        assets={[]}
        onResult={onResult}
        planImages={planImages}
      />
    );

    await user.click(screen.getByRole("button", { name: "根据正文设计动漫分镜" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(plannedArticle, plannedAssets));
    // 规划模型下拉默认选「默认」：不透传 model（第二参为 undefined）。
    expect(planImages).toHaveBeenCalledWith("2026-09-09T00:00:00.000Z", undefined);
  });

  it("passes the selected planning model to the plan request", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const planImages = vi.fn(async () => ({
      article,
      assets: [imageAsset({ id: "asset-new" })]
    }));
    const onResult = vi.fn();
    render(
      <ImagePlanningPanel
        article={article}
        assets={[]}
        onResult={onResult}
        planImages={planImages}
        llmEnabled
        availableModels={["glm-5.3-flash", "grok-4.6"]}
      />
    );

    await user.selectOptions(screen.getByLabelText("规划模型"), "glm-5.3-flash");
    await user.click(screen.getByRole("button", { name: "根据正文设计动漫分镜" }));

    await waitFor(() => expect(planImages).toHaveBeenCalledWith("2026-09-09T00:00:00.000Z", "glm-5.3-flash"));
  });

  it("sends style and character guide options with the plan request", async () => {
    const user = userEvent.setup();
    const character = {
      id: "char-1",
      name: "蘑菇老师",
      persona: "自媒体科普老师",
      description: "红伞白点的卡通蘑菇",
      mimeType: "image/png",
      filePath: "/tmp/mushroom.png",
      publicUrl: "/api/characters/char-1/image",
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z"
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/characters")
        ? { characters: [character] }
        : { style: "", characterId: null };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));
    try {
      const article = articleFixture({ blocks: [paragraphBlock()] });
      const planImages = vi.fn(async () => ({ article, assets: [imageAsset()] }));
      const onResult = vi.fn();
      render(
        <ImagePlanningPanel
          article={article}
          assets={[]}
          onResult={onResult}
          planImages={planImages}
        />
      );

      await screen.findByRole("option", { name: "蘑菇老师" });
      await user.selectOptions(screen.getByLabelText("绘制风格"), "简笔画");
      await user.selectOptions(screen.getByLabelText("参考形象"), "char-1");
      await user.click(screen.getByRole("button", { name: "根据正文设计动漫分镜" }));

      await waitFor(() =>
        expect(planImages).toHaveBeenCalledWith("2026-09-09T00:00:00.000Z", undefined, {
          style: "简笔画",
          characterId: "char-1"
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the re-analysis entry with a confirm guard when assets already exist", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const planImages = vi.fn();
    render(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset()]}
        onResult={vi.fn()}
        planImages={planImages}
      />
    );

    await user.click(screen.getByRole("button", { name: "按当前风格与形象重新设计分镜" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(planImages).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders planned asset details and returns the server snapshot after editing its prompt", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const asset = imageAsset();
    const updatedArticle = { ...article, updatedAt: "2026-09-09T00:00:02.000Z" };
    const updatedAssets = [imageAsset({ prompt: "编辑后的提示词" })];
    const updateAsset = vi.fn(async () => ({ article: updatedArticle, assets: updatedAssets }));
    const onResult = vi.fn();
    render(
      <ImagePlanningPanel
        article={article}
        assets={[asset]}
        onResult={onResult}
        updateAsset={updateAsset}
      />
    );

    expect(screen.getByRole("img", { name: "机会成本关系图" })).toHaveAttribute(
      "src",
      "/api/image-assets/asset-1/content"
    );
    expect(screen.getByText("概念图")).toBeVisible();
    expect(screen.getByText("解释机会成本的核心关系")).toBeVisible();
    expect(screen.getAllByText("第一段正文")[0]).toBeVisible();

    await user.clear(screen.getByLabelText("配图提示词 1"));
    await user.type(screen.getByLabelText("配图提示词 1"), "编辑后的提示词");
    await user.tab();

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(updatedArticle, updatedAssets)
    );
    expect(updateAsset).toHaveBeenCalledWith("asset-1", {
      prompt: "编辑后的提示词",
      expectedUpdatedAt: article.updatedAt
    });
  });

  it("shows server prompt and alternative text after a same-id asset response", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const serverAssets = [
      imageAsset({
        prompt: "服务端规范后的提示词",
        altText: "服务端更新的替代文本",
        updatedAt: "2026-09-09T00:00:02.000Z"
      })
    ];
    function TestPanel() {
      const [currentArticle, setCurrentArticle] = useState(article);
      const [assets, setAssets] = useState([imageAsset()]);
      return (
        <ImagePlanningPanel
          article={currentArticle}
          assets={assets}
          updateAsset={async () => ({
            article: { ...article, updatedAt: "2026-09-09T00:00:02.000Z" },
            assets: serverAssets
          })}
          onResult={(nextArticle, nextAssets) => {
            setCurrentArticle(nextArticle);
            setAssets(nextAssets);
          }}
        />
      );
    }
    render(<TestPanel />);

    await user.clear(screen.getByLabelText("配图提示词 1"));
    await user.type(screen.getByLabelText("配图提示词 1"), "客户端临时提示词");
    await user.tab();

    await waitFor(() =>
      expect(screen.getByLabelText("配图提示词 1")).toHaveValue("服务端规范后的提示词")
    );
    expect(screen.getByLabelText("配图替代文本 1")).toHaveValue("服务端更新的替代文本");
  });

  it("sends enable, placeholder refresh, and deletion mutations with the current version", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const asset = imageAsset();
    const payload = { article, assets: [asset] };
    const updateAsset = vi.fn(async () => payload);
    const refreshPlaceholder = vi.fn(async () => payload);
    const deleteAsset = vi.fn(async () => ({ article, assets: [] }));
    render(
      <ImagePlanningPanel
        article={article}
        assets={[asset]}
        onResult={vi.fn()}
        updateAsset={updateAsset}
        refreshPlaceholder={refreshPlaceholder}
        deleteAsset={deleteAsset}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "启用配图 1" }));
    await user.click(screen.getByRole("button", { name: "重建占位图 1" }));
    await user.click(screen.getByRole("button", { name: "删除配图 1" }));

    expect(updateAsset).toHaveBeenCalledWith("asset-1", {
      enabled: false,
      expectedUpdatedAt: article.updatedAt
    });
    expect(refreshPlaceholder).toHaveBeenCalledWith("asset-1", article.updatedAt);
    expect(deleteAsset).toHaveBeenCalledWith("asset-1", article.updatedAt);
  });

  it("generates a real image when configured, then allows regeneration after success", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const generatedArticle = { ...article, updatedAt: "2026-09-09T00:00:03.000Z" };
    const generatedAssets = [
      imageAsset({ status: "generated", publicUrl: "https://cdn.example.test/a.png" })
    ];
    const generateImage = vi.fn(async () => ({ article: generatedArticle, assets: generatedAssets }));

    // 未配置生成服务时按钮不出现。
    const { unmount } = render(
      <ImagePlanningPanel article={article} assets={[imageAsset()]} onResult={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "生成配图 1" })).not.toBeInTheDocument();
    unmount();

    // 有状态包装组件模拟 workspace 的 onResult 回灌。
    function TestPanel() {
      const [currentArticle, setCurrentArticle] = useState(article);
      const [assets, setAssets] = useState([imageAsset()]);
      return (
        <ImagePlanningPanel
          article={currentArticle}
          assets={assets}
          generateImage={generateImage}
          onResult={(nextArticle, nextAssets) => {
            setCurrentArticle(nextArticle);
            setAssets(nextAssets);
          }}
        />
      );
    }
    render(<TestPanel />);

    await user.click(screen.getByRole("button", { name: "生成配图 1" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重新生成配图 1" })).toBeVisible()
    );
    expect(generateImage).toHaveBeenCalledWith("asset-1", article.updatedAt, undefined);
    expect(screen.getByText("已生成")).toBeVisible();
  });

  it("generates all pending images sequentially in one click during the initial stage", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const initialAssets = [imageAsset({ id: "asset-1" }), imageAsset({ id: "asset-2" })];
    let calls = 0;
    const generateImage = vi.fn(async () => {
      calls += 1;
      // 真实后端每次返回全量最新状态：已完成的保持 generated。
      const generatedIds = calls === 1 ? ["asset-1"] : ["asset-1", "asset-2"];
      return {
        article: { ...article, updatedAt: `2026-09-09T00:00:0${calls + 3}.000Z` },
        assets: initialAssets.map((asset) =>
          generatedIds.includes(asset.id) ? { ...asset, status: "generated" as const } : asset
        )
      };
    });
    const onResult = vi.fn();

    function TestPanel() {
      const [currentArticle, setCurrentArticle] = useState(article);
      const [assets, setAssets] = useState(initialAssets);
      return (
        <ImagePlanningPanel
          article={currentArticle}
          assets={assets}
          generateImage={generateImage}
          onResult={(nextArticle, nextAssets) => {
            setCurrentArticle(nextArticle);
            setAssets(nextAssets);
            onResult(nextArticle, nextAssets);
          }}
        />
      );
    }
    render(<TestPanel />);

    // 初始阶段：一键按钮可见。
    await screen.findByRole("button", { name: "一键生成全部配图（2 张）" });
    await user.click(screen.getByRole("button", { name: "一键生成全部配图（2 张）" }));

    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(2));
    // 顺序执行；第二张用第一张完成后的最新文章版本。
    expect(generateImage).toHaveBeenNthCalledWith(1, "asset-1", article.updatedAt, undefined);
    expect(generateImage).toHaveBeenNthCalledWith(
      2,
      "asset-2",
      "2026-09-09T00:00:04.000Z",
      undefined
    );
    // 完成后进入调整阶段：一键按钮消失，单张重新生成按钮仍在。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /一键生成全部配图/ })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "重新生成配图 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新生成配图 2" })).toBeVisible();
  });

  it("hides and disables the generate entry per status and configuration", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const generateImage = vi.fn(async () => ({ article, assets: [imageAsset()] }));

    // disabled 状态的资产不能生成。
    const { rerender } = render(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset({ status: "disabled" })]}
        onResult={vi.fn()}
        generateImage={generateImage}
      />
    );
    expect(screen.getByRole("button", { name: "生成配图 1" })).toBeDisabled();

    // generating 状态的资产不能重复触发生成。
    rerender(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset({ status: "generating" })]}
        onResult={vi.fn()}
        generateImage={generateImage}
      />
    );
    expect(screen.getByRole("button", { name: "生成配图 1" })).toBeDisabled();

    // 正常状态可点击。
    rerender(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset()]}
        onResult={vi.fn()}
        generateImage={generateImage}
      />
    );
    await user.click(screen.getByRole("button", { name: "生成配图 1" }));
    await waitFor(() => expect(generateImage).toHaveBeenCalledOnce());
  });

  it("shows assets without editable controls in read-only mode", () => {
    const article = articleFixture({ blocks: [paragraphBlock()] });
    render(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset()]}
        readOnly
        onResult={vi.fn()}
      />
    );

    expect(screen.getByRole("img", { name: "机会成本关系图" })).toBeVisible();
    expect(screen.getByText("待生成")).toBeVisible();
    // 只读态不提供可编辑控件；大图预览入口保留，但这一张还没生成过，所以是禁用的。
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览配图 1" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "生成配图 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除配图 1" })).not.toBeInTheDocument();
  });

  it("disables every mutation control while article changes are being saved", async () => {
    const user = userEvent.setup();
    const article = articleFixture({ blocks: [paragraphBlock()] });
    const planImages = vi.fn(async () => ({ article, assets: [] }));
    const updateAsset = vi.fn(async () => ({ article, assets: [imageAsset()] }));
    const refreshPlaceholder = vi.fn(async () => ({ article, assets: [imageAsset()] }));
    const deleteAsset = vi.fn(async () => ({ article, assets: [] }));
    render(
      <ImagePlanningPanel
        article={article}
        assets={[imageAsset()]}
        locked
        onResult={vi.fn()}
        planImages={planImages}
        updateAsset={updateAsset}
        refreshPlaceholder={refreshPlaceholder}
        deleteAsset={deleteAsset}
      />
    );

    expect(screen.getByText("正在保存文章，保存完成后可操作配图")).toBeVisible();
    expect(screen.getByLabelText("配图提示词 1")).toBeDisabled();
    expect(screen.getByLabelText("配图替代文本 1")).toBeDisabled();
    expect(screen.getByLabelText("配图比例 1")).toBeDisabled();
    expect(screen.getByLabelText("配图锚点 1")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "启用配图 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重建占位图 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除配图 1" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "重建占位图 1" }));
    await user.click(screen.getByRole("button", { name: "删除配图 1" }));

    expect(planImages).not.toHaveBeenCalled();
    expect(updateAsset).not.toHaveBeenCalled();
    expect(refreshPlaceholder).not.toHaveBeenCalled();
    expect(deleteAsset).not.toHaveBeenCalled();

    const { unmount } = render(
      <ImagePlanningPanel
        article={article}
        assets={[]}
        locked
        onResult={vi.fn()}
        planImages={planImages}
      />
    );
    const lockedPlanButton = screen.getByRole("button", { name: "根据正文设计动漫分镜" });
    expect(lockedPlanButton).toBeDisabled();
    await user.click(lockedPlanButton);
    expect(planImages).not.toHaveBeenCalled();
    unmount();
  });
});

/** 素材库条目 fixture：默认属于 asset-1、未被选用。 */
function imageGeneration(overrides: Partial<ImageLibraryItem> = {}): ImageLibraryItem {
  return {
    id: "gen-1",
    articleId: "article-1",
    assetId: "asset-1",
    prompt: "清晰的机会成本信息图",
    model: "seedream-4.5",
    filePath: "/tmp/asset-1-gen-1.png",
    publicUrl: null,
    selected: false,
    createdAt: "2026-09-09T01:00:00.000Z",
    assetType: "concept",
    assetPurpose: "解释机会成本的核心关系",
    ...overrides
  };
}

/**
 * 素材库只走 `/api/articles/:id/image-generations` 一个接口；
 * 面板内其余请求（风格库、模型目录、配图偏好）统一回空对象即可。
 * 每次调用都新建 Response——Response body 只能读一次，复用会抛「body already consumed」。
 */
function stubGenerations(generations: ImageLibraryItem[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes("/image-generations") ? { generations } : {};
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
}

/** 大图预览标题由图标 + 多段文本拼成，直接取 h2 的纯文本比对，省得纠缠节点切分。 */
function lightboxHeading() {
  const heading = screen
    .getByRole("dialog", { name: "配图大图预览" })
    .querySelector("h2")?.textContent;
  return heading?.replace(/\s+/g, " ") ?? "";
}

function versionStripLabel() {
  const label = document.querySelector(".image-generation-strip-label")?.textContent;
  return label?.replace(/\s+/g, " ") ?? "";
}

describe("ImagePlanningPanel image versions", () => {
  const article = articleFixture({ blocks: [paragraphBlock()] });
  const generatedAsset = imageAsset({ status: "generated" });

  it("lists every kept version in the strip and marks the one in use", async () => {
    stubGenerations([
      imageGeneration({ id: "gen-2", selected: true, createdAt: "2026-09-09T02:00:00.000Z" }),
      imageGeneration()
    ]);
    try {
      render(<ImagePlanningPanel article={article} assets={[generatedAsset]} onResult={vi.fn()} />);

      await screen.findByRole("button", { name: "查看配图 1 的第 2 版" });
      // 版本条按时间正序：第 1 版在左、第 2 版在右，正在用的那版单独挂「使用中」角标。
      expect(versionStripLabel()).toBe("生成版本 2 版，正在使用第 2 版");
      expect(screen.getByRole("button", { name: "查看配图 1 的第 1 版" })).toBeVisible();
      expect(document.querySelectorAll(".image-generation-badge")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the large preview and flips versions along the displayed order", async () => {
    const user = userEvent.setup();
    stubGenerations([
      imageGeneration({ id: "gen-2", selected: true, createdAt: "2026-09-09T02:00:00.000Z" }),
      imageGeneration()
    ]);
    try {
      render(<ImagePlanningPanel article={article} assets={[generatedAsset]} onResult={vi.fn()} />);

      await user.click(await screen.findByRole("button", { name: "查看配图 1 的第 2 版" }));
      expect(lightboxHeading()).toBe("概念图 · 第 2 / 2 版");

      // 「上一版」＝版本条上左边那张＝更早的一版。
      await user.click(screen.getByRole("button", { name: "上一版" }));
      expect(lightboxHeading()).toBe("概念图 · 第 1 / 2 版");
      expect(within(screen.getByRole("dialog")).getByRole("img", { name: "机会成本关系图" })).toHaveAttribute(
        "src",
        "/api/image-generations/gen-1/content"
      );

      // 键盘左右翻版和 Esc 关闭。
      await user.keyboard("{ArrowRight}");
      expect(lightboxHeading()).toBe("概念图 · 第 2 / 2 版");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves a version onto another slot instead of copying it", async () => {
    const user = userEvent.setup();
    stubGenerations([imageGeneration({ selected: true })]);
    const selectGeneration = vi.fn(async () => ({
      article,
      assets: [generatedAsset, imageAsset({ id: "asset-2" })]
    }));
    try {
      render(
        <ImagePlanningPanel
          article={article}
          assets={[generatedAsset, imageAsset({ id: "asset-2", purpose: "第二张配图" })]}
          onResult={vi.fn()}
          selectGeneration={selectGeneration}
        />
      );

      await user.click(await screen.findByRole("button", { name: "预览配图 1" }));
      // 目标位置就是它自己、而且已经在用：主按钮没有可执行的动作。
      expect(screen.getByRole("button", { name: "使用这一版" })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText("用到哪张配图"), "asset-2");
      await user.click(screen.getByRole("button", { name: "移到这张配图" }));

      await waitFor(() =>
        expect(selectGeneration).toHaveBeenCalledWith("asset-2", "gen-1", article.updatedAt)
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes the previewed version only after confirmation", async () => {
    const user = userEvent.setup();
    stubGenerations([imageGeneration({ selected: true })]);
    const deleteGeneration = vi.fn(async () => ({ article, assets: [imageAsset()] }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(
        <ImagePlanningPanel
          article={article}
          assets={[generatedAsset]}
          onResult={vi.fn()}
          deleteGeneration={deleteGeneration}
        />
      );

      await user.click(await screen.findByRole("button", { name: "预览配图 1" }));
      // 取消确认：什么都不做，预览继续开着。
      await user.click(screen.getByRole("button", { name: "删除这一版" }));
      expect(deleteGeneration).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await user.click(screen.getByRole("button", { name: "删除这一版" }));
      await waitFor(() => expect(deleteGeneration).toHaveBeenCalledWith("gen-1", article.updatedAt));
    } finally {
      confirmSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps every generation browsable in the material library", async () => {
    const user = userEvent.setup();
    stubGenerations([
      imageGeneration({ id: "gen-2", selected: true, createdAt: "2026-09-09T02:00:00.000Z" }),
      imageGeneration({ id: "gen-3", assetId: "asset-2", assetType: "cover", selected: true })
    ]);
    try {
      render(
        <ImagePlanningPanel
          article={article}
          assets={[generatedAsset, imageAsset({ id: "asset-2", type: "cover" })]}
          onResult={vi.fn()}
        />
      );

      await user.click(await screen.findByRole("button", { name: /素材库/ }));
      // 素材库按最新在前浏览，并标出每张图归属的槽位。
      const captions = Array.from(document.querySelectorAll(".image-library-caption")).map(
        (node) => node.textContent
      );
      expect(captions).toEqual(["配图 1 · 使用中", "配图 2 · 使用中"]);
      expect(screen.getAllByRole("button", { name: /预览素材库图片/ })).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
