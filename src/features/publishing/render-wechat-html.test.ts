// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { imageBlock, knowledgeCardBlock, paragraphBlock } from "../../../tests/fixtures/article";
import {
  blocksToPlainText,
  renderWechatHtml,
  renderWechatStripFlowHtml
} from "./render-wechat-html";

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

function stripAsset(id: string, overrides: Partial<ImageAsset> = {}): ImageAsset {
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
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides
  };
}

describe("renderWechatStripFlowHtml", () => {
  const blocks: ContentBlock[] = [
    {
      id: "s1",
      type: "image",
      content: "/api/image-assets/strip-1/content",
      altText: "标题｜段图｜换挡",
      order: 0,
      version: 1
    },
    { id: "lead", type: "paragraph", content: "作者手加的导语", order: 1, version: 1 },
    {
      id: "s2",
      type: "image",
      content: "/api/image-assets/strip-2/content",
      altText: "标题｜段图｜适应",
      order: 2,
      version: 1
    }
  ];
  const assets = [stripAsset("strip-1"), stripAsset("strip-2")];

  it("段图整宽输出且不带 figcaption，残留文本默认不渲染", () => {
    const html = renderWechatStripFlowHtml(blocks, assets, "ink");

    expect(html).toContain('src="/api/image-assets/strip-1/content"');
    expect(html).toContain('src="/api/image-assets/strip-2/content"');
    expect(html).not.toContain("figcaption");
    expect(html).not.toContain("作者手加的导语");
    expect(html).toContain("max-width:100%");
  });

  it("作者确认保留时，残留块按通用块渲染进段图之间", () => {
    const html = renderWechatStripFlowHtml(blocks, assets, "ink", {
      includeResidualText: true
    });

    expect(html).toContain("作者手加的导语");
    expect(html).toContain('src="/api/image-assets/strip-1/content"');
    expect(html).toContain('src="/api/image-assets/strip-2/content"');
  });

  it("非段图的 image 块按残留处理", () => {
    const withOrphan: ContentBlock[] = [...blocks, { ...imageBlock("asset-1"), order: 3 }];

    expect(renderWechatStripFlowHtml(withOrphan, assets, "ink")).not.toContain(
      'src="/api/image-assets/asset-1/content"'
    );
    expect(
      renderWechatStripFlowHtml(withOrphan, assets, "ink", { includeResidualText: true })
    ).toContain('src="/api/image-assets/asset-1/content"');
  });

  it("未生成的段图资产不算段图，其 image 块默认不渲染", () => {
    const pendingAssets = [
      stripAsset("strip-1"),
      { ...stripAsset("strip-2"), status: "placeholder" as const }
    ];
    const html = renderWechatStripFlowHtml(blocks, pendingAssets, "ink");

    expect(html).toContain('src="/api/image-assets/strip-1/content"');
    expect(html).not.toContain('src="/api/image-assets/strip-2/content"');
  });
});
