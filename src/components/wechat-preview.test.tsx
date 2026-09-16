import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { imageBlock, paragraphBlock } from "../../tests/fixtures/article";
import { renderWechatHtml } from "@/features/publishing/render-wechat-html";
import { buildPrintDocument, WechatPreview } from "./wechat-preview";

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

  it("hands the rendered article to the print pipeline and explains the next step", async () => {
    const user = userEvent.setup();
    const exportPdf = vi.fn();
    render(<WechatPreview blocks={[paragraphBlock("要导出成 PDF 的正文")]} exportPdf={exportPdf} />);

    await user.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(exportPdf).toHaveBeenCalledOnce();
    expect(exportPdf.mock.calls[0][0]).toContain("要导出成 PDF 的正文");
    expect(exportPdf.mock.calls[0][0]).toContain("style=");
    // 打印对话框不是一步到位，得告诉作者接下来该选什么。
    expect(await screen.findByText(/另存为 PDF/)).toBeVisible();
  });

  it("exports the theme the author is currently looking at", async () => {
    const user = userEvent.setup();
    const exportPdf = vi.fn();
    const blocks = [paragraphBlock("换主题后导出")];
    render(<WechatPreview blocks={blocks} exportPdf={exportPdf} />);

    await user.click(screen.getByRole("button", { name: "清朗" }));
    await user.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(exportPdf).toHaveBeenCalledWith(renderWechatHtml(blocks, "clear"));
  });

  it("wraps the article in an A4 print document", () => {
    const printDocument = buildPrintDocument('<section style="max-width:677px">文章正文</section>');

    expect(printDocument).toContain("@page { size: A4");
    expect(printDocument).toContain("文章正文");
    expect(printDocument).toContain("<title>公众号文章</title>");
    // 配图不能跨页断开，也不能横向溢出。
    expect(printDocument).toContain("break-inside: avoid");
    expect(printDocument).toContain("max-width: 100%");
  });
});
