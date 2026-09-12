// @vitest-environment node

import { describe, expect, it } from "vitest";
import { imageBlock, knowledgeCardBlock, paragraphBlock } from "../../../tests/fixtures/article";
import { blocksToPlainText, renderWechatHtml } from "./render-wechat-html";

describe("renderWechatHtml", () => {
  it("renders inline styles and escapes user html", () => {
    const html = renderWechatHtml(
      [paragraphBlock('<img src=x onerror="alert(1)">')],
      "ink"
    );

    expect(html).toContain("style=");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<style");
  });

  it("renders a readable knowledge card", () => {
    const html = renderWechatHtml([knowledgeCardBlock()], "ink");

    expect(html).toContain("核心关系");
    expect(html).toContain("选择当前方案");
    expect(html).toContain("display:grid");
  });

  it("renders only HTTPS and controlled internal image sources", () => {
    const internalImage = imageBlock("asset-1");
    const httpsImage = { ...imageBlock("asset-2"), content: "https://images.example.test/chart.png" };
    const invalidImages = [
      "javascript:alert(1)",
      "data:image/svg+xml,unsafe",
      "//images.example.test/chart.png",
      "/api/articles/article-1/image-assets",
      '/api/image-assets/asset-3/content" onerror="alert(1)',
      'https://images.example.test/a"b.png',
      "https://images.example.test/a'b.png",
      "https://images.example.test/a\u0001b.png"
    ].map((content, index) => ({ ...imageBlock(`asset-invalid-${index}`), content, order: index + 2 }));

    const html = renderWechatHtml([internalImage, httpsImage, ...invalidImages], "ink");

    expect(html).toContain('src="/api/image-assets/asset-1/content"');
    expect(html).toContain('src="https://images.example.test/chart.png"');
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("max-width:100%");
  });

  it("uses image alt text instead of image URLs in plain text", () => {
    expect(blocksToPlainText([imageBlock("asset-1")])).toBe("[配图：示例配图]");
  });
});
