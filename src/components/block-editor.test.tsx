import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/features/images/domain";
import { imageBlock, twoBlocks } from "../../tests/fixtures/article";
import { BlockEditor } from "./block-editor";

function stripAsset(): ImageAsset {
  return {
    id: "asset-1",
    articleId: "article-1",
    type: "comic_strip",
    anchorBlockId: "block-image-1",
    purpose: "分段长图｜开场｜图 + 文",
    prompt: "分段拼接",
    altText: "什么是机会成本｜段图｜开场",
    aspectRatio: "portrait",
    status: "generated",
    placeholderUrl: null,
    filePath: "C:/tmp/strip.png",
    publicUrl: null,
    manuallyEdited: true,
    consumedContent: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z"
  };
}

describe("BlockEditor", () => {
  it("edits only the selected block", async () => {
    const user = userEvent.setup();
    function TestEditor() {
      const [blocks, setBlocks] = useState(twoBlocks());
      return (
        <>
          <BlockEditor blocks={blocks} onChange={setBlocks} />
          <output aria-label="第二块内容">{blocks[1].content}</output>
        </>
      );
    }
    render(<TestEditor />);

    await user.clear(screen.getByLabelText("正文块 1"));
    await user.type(screen.getByLabelText("正文块 1"), "新的第一段");

    expect(screen.getByLabelText("正文块 1")).toHaveValue("新的第一段");
    expect(screen.getByLabelText("第二块内容")).toHaveTextContent("第二段正文");
  });

  it("keeps an image block's layout stable and restores its placeholder when loading fails", () => {
    render(<BlockEditor blocks={[imageBlock()]} onChange={() => undefined} />);

    const image = screen.getByRole("img", { name: "示例配图" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image.closest("figure")).toHaveStyle({ aspectRatio: "1.5" });
    expect(screen.queryByText("图片位置")).not.toBeInTheDocument();

    fireEvent.error(image);

    expect(screen.getByText("图片位置")).toBeVisible();
    expect(screen.getByText("图片位置").closest("figure")).toHaveStyle({ aspectRatio: "1.5" });
  });

  it("shows a composed strip at its own proportions instead of cropping it into the enum box", () => {
    // 段图实测 1080×2308（约 0.47），落库枚举只有 portrait=0.75：按枚举框死再
    // object-fit: cover，下半截会被裁掉、字号被放大——作者看到的是放大的一截。
    render(
      <BlockEditor blocks={[imageBlock()]} onChange={() => undefined} imageAssets={[stripAsset()]} />
    );

    const figure = screen.getByRole("img", { name: "示例配图" }).closest("figure");
    expect(figure).toHaveClass("editor-image-block-strip");
    expect(figure).not.toHaveStyle({ aspectRatio: "0.75" });
    // 文案已烘进段图，再叠一层图注只会糊在段图自带的文字卡上。
    expect(figure?.querySelector("figcaption")).toBeNull();
  });

  it("keeps the enum aspect ratio for ordinary pictures", () => {
    render(
      <BlockEditor
        blocks={[imageBlock()]}
        onChange={() => undefined}
        imageAssets={[{ ...stripAsset(), type: "storyboard", aspectRatio: "portrait" }]}
      />
    );

    const figure = screen.getByRole("img", { name: "示例配图" }).closest("figure");
    expect(figure).toHaveStyle({ aspectRatio: "0.75" });
    expect(figure?.querySelector("figcaption")).not.toBeNull();
  });
});
