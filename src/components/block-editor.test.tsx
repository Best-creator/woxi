import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { imageBlock, twoBlocks } from "../../tests/fixtures/article";
import { BlockEditor } from "./block-editor";

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
});
