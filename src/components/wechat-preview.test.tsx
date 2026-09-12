import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { imageBlock, paragraphBlock } from "../../tests/fixtures/article";
import { WechatPreview } from "./wechat-preview";

describe("WechatPreview", () => {
  it("copies the rendered article as rich text", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<WechatPreview blocks={[paragraphBlock("公众号正文")]} copy={copy} />);

    await user.click(screen.getByRole("button", { name: "复制到公众号" }));

    expect(await screen.findByText("已复制富文本")).toBeVisible();
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0][0]).toContain("公众号正文");
    expect(copy.mock.calls[0][0]).toContain("style=");
  });

  it("offers manual selection when rich copy is unavailable", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockRejectedValue(new Error("denied"));
    render(<WechatPreview blocks={[paragraphBlock()]} copy={copy} />);

    await user.click(screen.getByRole("button", { name: "复制到公众号" }));

    expect(
      await screen.findByText(/浏览器未允许富文本复制/)
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "选择预览内容" })).toBeVisible();
  });

  it("copies controlled placeholder images as rich text without exposing their URL in plain text", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<WechatPreview blocks={[imageBlock("asset-1")]} copy={copy} />);

    await user.click(screen.getByRole("button", { name: "复制到公众号" }));

    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining('src="/api/image-assets/asset-1/content"'),
      "[配图：示例配图]"
    );
  });
});
