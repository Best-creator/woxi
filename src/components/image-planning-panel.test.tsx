import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { articleFixture, paragraphBlock } from "../../tests/fixtures/article";
import type { ImageAsset } from "@/features/images/domain";
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

    await user.click(screen.getByRole("button", { name: "分析配图需求" }));

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
    await user.click(screen.getByRole("button", { name: "分析配图需求" }));

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
      await user.click(screen.getByRole("button", { name: "分析配图需求" }));

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

    await user.click(screen.getByRole("button", { name: "按当前风格与形象重新分析" }));

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
    expect(generateImage).toHaveBeenCalledWith("asset-1", article.updatedAt);
    expect(screen.getByText("已生成")).toBeVisible();
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
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
    const lockedPlanButton = screen.getByRole("button", { name: "分析配图需求" });
    expect(lockedPlanButton).toBeDisabled();
    await user.click(lockedPlanButton);
    expect(planImages).not.toHaveBeenCalled();
    unmount();
  });
});
