import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { imageBlock, paragraphBlock } from "../../tests/fixtures/article";
import { renderWechatHtml } from "@/features/publishing/render-wechat-html";
import {
  buildPrintDocument,
  fitOversizedImages,
  waitForPrintableImages,
  WechatPreview
} from "./wechat-preview";

function stripAsset(id: string): ImageAsset {
  return {
    id,
    articleId: "article-1",
    type: "comic_strip",
    anchorBlockId: "anchor",
    purpose: "分段长图",
    prompt: "prompt",
    altText: "段图",
    aspectRatio: "landscape",
    status: "generated",
    placeholderUrl: null,
    filePath: `.data/${id}.png`,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z"
  };
}

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

  it("有分镜设计时按纯段图流渲染预览：段图无 figcaption，残留文本保留", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    const blocks: ContentBlock[] = [
      {
        id: "s1",
        type: "image",
        content: "/api/image-assets/strip-1/content",
        altText: "标题｜段图｜换挡",
        order: 0,
        version: 1
      },
      { id: "lead", type: "paragraph", content: "作者手加的导语", order: 1, version: 1 }
    ];
    render(
      <WechatPreview
        blocks={blocks}
        assets={[stripAsset("strip-1")]}
        stripFlow={true}
        copy={copy}
      />
    );

    await user.click(screen.getByRole("button", { name: "复制到公众号" }));

    expect(copy).toHaveBeenCalledOnce();
    const html = copy.mock.calls[0][0] as string;
    expect(html).toContain('src="/api/image-assets/strip-1/content"');
    expect(html).not.toContain("figcaption");
    expect(html).toContain("作者手加的导语");
  });

  it("纯文字段在预览里也是文字卡：plainTextBlockIds 与推送同源传入", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    const blocks: ContentBlock[] = [
      {
        id: "s1",
        type: "image",
        content: "/api/image-assets/strip-1/content",
        altText: "标题｜段图｜换挡",
        order: 0,
        version: 1
      },
      {
        id: "plain-1",
        type: "paragraph",
        content: "雾蒙蒙的清晨小鹿踩着露水走进森林深处寻找蘑菇",
        order: 1,
        version: 1
      }
    ];
    render(
      <WechatPreview
        blocks={blocks}
        assets={[stripAsset("strip-1")]}
        stripFlow={true}
        plainTextBlockIds={["plain-1"]}
        copy={copy}
      />
    );

    await user.click(screen.getByRole("button", { name: "复制到公众号" }));

    const html = copy.mock.calls[0][0] as string;
    // 点名的纯文字段是段图文字带同款条带（全宽 91%）+ 服务端预断行，不是普通的两端对齐段落。
    expect(html).toContain("width:91%");
    expect(html).toContain("<br>");
    expect(html).not.toContain('text-align:justify;">雾蒙蒙');
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
    const printDocument = buildPrintDocument(
      '<section style="max-width:677px"><figure><img src="/api/image-assets/asset-1/content" loading="lazy"></figure>文章正文</section>'
    );

    expect(printDocument).toContain("@page { size: A4");
    expect(printDocument).toContain("文章正文");
    expect(printDocument).toContain("<title>公众号文章</title>");
    // 配图不能跨页断开，也不能横向溢出。
    expect(printDocument).toContain("break-inside: avoid");
    expect(printDocument).toContain("max-width: 100%");
    // 离屏 iframe 里懒加载的图不会被取到，打印文档必须改成立即加载。
    expect(printDocument).toContain('loading="eager"');
    expect(printDocument).not.toContain('loading="lazy"');
  });

  it("waits for every print image before letting the browser print", async () => {
    const image = document.createElement("img");
    image.src = "/api/image-assets/asset-1/content";
    image.decode = vi.fn(async () => undefined);
    const frameWindow = { document: { images: [image] } } as unknown as Window;

    let settled = false;
    const pending = waitForPrintableImages(frameWindow, 1000).then(() => {
      settled = true;
    });
    await Promise.resolve();
    // 图还没回来就不该开始打印，否则 PDF 里是空的。
    expect(settled).toBe(false);

    image.dispatchEvent(new Event("load"));
    await pending;
    expect(settled).toBe(true);
    expect(image.decode).toHaveBeenCalledOnce();
  });

  it("does not hang on a print image that never loads", async () => {
    const image = document.createElement("img");
    image.src = "/api/image-assets/asset-1/content";
    image.decode = vi.fn(async () => undefined);
    const frameWindow = { document: { images: [image] } } as unknown as Window;

    // 上游图床挂了也要照常出 PDF：到点放行。
    await waitForPrintableImages(frameWindow, 20);
  });

  it("shrinks an oversized strip onto a single page and leaves normal images alone", () => {
    const oversized = document.createElement("img");
    oversized.src = "/api/image-assets/strip-3/content";
    vi.spyOn(oversized, "getBoundingClientRect").mockReturnValue({
      height: 1449,
      width: 677
    } as DOMRect);
    const normal = document.createElement("img");
    normal.src = "/api/image-assets/strip-1/content";
    vi.spyOn(normal, "getBoundingClientRect").mockReturnValue({
      height: 900,
      width: 677
    } as DOMRect);
    const frameWindow = {
      document: { images: [oversized, normal] }
    } as unknown as Window;

    fitOversizedImages(frameWindow);

    // 超页高的段图等比缩进一页并居中，而不是被打印拦腰切断。
    expect(oversized.style.height).toBe("1000px");
    expect(oversized.style.width).toBe("auto");
    expect(oversized.style.margin).toBe("0px auto");
    // 放得下的图不动：保持原宽度，整篇左右边缘才齐。
    expect(normal.style.height).toBe("");
    expect(normal.style.width).toBe("");
  });
});
