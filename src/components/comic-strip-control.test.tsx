import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { articleFixture } from "../../tests/fixtures/article";
import { ComicStripControl } from "./comic-strip-control";

/** 一格标题 + 一句文案，正是漫画预设产生的形状。 */
const PANEL_SOURCE: ContentBlock[] = [
  { id: "h1", type: "heading", content: "第一格", order: 0, level: 2, version: 1 },
  { id: "p1", type: "paragraph", content: "盯着屏幕时眨眼次数掉了一半。", order: 1, version: 1 },
  { id: "h2", type: "heading", content: "第二格", order: 2, level: 2, version: 1 },
  { id: "p2", type: "paragraph", content: "泪膜撑不住，眼睛就开始报警。", order: 3, version: 1 },
  { id: "h3", type: "heading", content: "第三格", order: 4, level: 2, version: 1 },
  { id: "p3", type: "paragraph", content: "二十分钟看远处二十秒。", order: 5, version: 1 }
];

function panel(anchorBlockId: string, status: ImageAsset["status"] = "generated"): ImageAsset {
  return {
    id: `panel-${anchorBlockId}`,
    articleId: "article-1",
    type: "storyboard",
    anchorBlockId,
    purpose: `分镜 ${anchorBlockId}`,
    prompt: "分镜画面",
    altText: "分镜",
    aspectRatio: "square",
    status,
    placeholderUrl: null,
    filePath: status === "generated" ? `C:/tmp/${anchorBlockId}.png` : null,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z"
  };
}

/** 已经拼过一张长图之后的正文：被替换的图文整体消失，只在原位留下长图那一块。 */
const COMPOSED_BLOCKS: ContentBlock[] = [
  {
    id: "block-strip",
    type: "image",
    content: "/api/image-assets/strip-1/content",
    altText: "漫画长图",
    assetId: "strip-1",
    order: 0,
    version: 1
  }
];

function stripAsset(): ImageAsset {
  return {
    ...panel("h1"),
    id: "strip-1",
    type: "comic_strip",
    purpose: "漫画长图｜3 格分镜｜image_text_image",
    filePath: "C:/tmp/strip.png",
    consumedContent: {
      blocks: PANEL_SOURCE.map((block) => ({ ...block })),
      resumeBeforeBlockId: null
    }
  };
}

function setup(overrides: {
  blocks?: ContentBlock[];
  assets?: ImageAsset[];
  disabled?: boolean;
} = {}) {
  const article = articleFixture({ blocks: overrides.blocks ?? PANEL_SOURCE });
  const props = {
    article,
    assets: overrides.assets ?? [panel("p1"), panel("p2"), panel("p3")],
    onResult: vi.fn(),
    composeComicStrip: vi.fn().mockResolvedValue({}),
    removeComicStrip: vi.fn().mockResolvedValue({}),
    ...(overrides.disabled === undefined ? {} : { disabled: overrides.disabled })
  };
  render(<ComicStripControl {...props} />);
  return props;
}

describe("ComicStripControl", () => {
  it("enables composing once every panel has a real image", async () => {
    const props = setup();

    expect(screen.getByRole("status")).toHaveTextContent("已识别 3 格分镜");
    const button = screen.getByRole("button", { name: "合成漫画长图" });
    expect(button).toBeEnabled();

    await userEvent.click(button);
    // 默认排法就是最像连环画的「图 + 文 + 图」。
    expect(props.composeComicStrip).toHaveBeenCalledWith(articleFixture().updatedAt, "image_text_image");
  });

  it("still allows re-composing after a strip already replaced the panels", async () => {
    // 回归：拼过长图之后正文里只剩那张长图，如果直接拿 article.blocks 去识别，
    // 就会以为「这篇没有分镜」，把「按新模式重拼」一直置灰——用户看到按钮却点不动。
    const props = setup({
      blocks: COMPOSED_BLOCKS,
      assets: [panel("p1"), panel("p2"), panel("p3"), stripAsset()]
    });

    const button = screen.getByRole("button", { name: "按新模式重拼" });
    expect(button).toBeEnabled();

    await userEvent.click(screen.getByRole("radio", { name: "文 + 图" }));
    await userEvent.click(button);

    expect(props.composeComicStrip).toHaveBeenCalledWith(articleFixture().updatedAt, "text_image");
  });

  it("offers to cancel the strip so the original text can come back", async () => {
    const props = setup({
      blocks: COMPOSED_BLOCKS,
      assets: [panel("p1"), panel("p2"), panel("p3"), stripAsset()]
    });

    expect(screen.getByRole("status")).toHaveTextContent("取消长图可原样还原");
    expect(screen.getByRole("figure")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "取消长图" }));

    expect(props.removeComicStrip).toHaveBeenCalledWith(articleFixture().updatedAt);
  });

  it("refuses to compose while a panel still has no image", () => {
    setup({ assets: [panel("p1"), panel("p2"), panel("p3", "placeholder")] });

    expect(screen.getByRole("status")).toHaveTextContent("还有 1 格分镜没生成图片");
    expect(screen.getByRole("button", { name: "合成漫画长图" })).toBeDisabled();
  });

  it("explains that a single panel is not enough to make a strip", () => {
    setup({ blocks: PANEL_SOURCE.slice(0, 2), assets: [panel("p1")] });

    expect(screen.getByRole("status")).toHaveTextContent("至少要两格分镜");
    expect(screen.getByRole("button", { name: "合成漫画长图" })).toBeDisabled();
  });

  it("locks the controls while the article is being saved", () => {
    setup({ disabled: true });

    expect(screen.getByRole("button", { name: "合成漫画长图" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "图 + 文" })).toBeDisabled();
  });
});
