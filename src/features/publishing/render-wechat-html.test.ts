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

  it("封面块恒不进正文流：预览开了残留文本也不渲染（封面是草稿头图不是正文）", () => {
    // 回归（2026-09-21 用户被困惑）：预览把封面当残留块渲染，还带上 altText
    // 说明文字（「文章标题 封面」）的 figcaption——推出去其实没有，预览误导。
    const cover = { ...stripAsset("cover-1"), type: "cover" as const, anchorBlockId: null };
    const withCover: ContentBlock[] = [
      {
        id: "cover-block",
        type: "image",
        content: "/api/image-assets/cover-1/content",
        assetId: "cover-1",
        altText: "文章标题 封面",
        order: 0,
        version: 1
      },
      ...blocks.map((block, index) => ({ ...block, order: index + 1 }))
    ];

    for (const options of [
      undefined,
      { includeResidualText: true }
    ] as const) {
      const html = renderWechatStripFlowHtml(withCover, [cover, ...assets], "ink", options);
      expect(html).not.toContain('src="/api/image-assets/cover-1/content"');
      expect(html).not.toContain("文章标题 封面");
      expect(html).not.toContain("figcaption");
    }
    // 段图不受影响，照常渲染。
    expect(
      renderWechatStripFlowHtml(withCover, [cover, ...assets], "ink")
    ).toContain('src="/api/image-assets/strip-1/content"');
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

  it("纯文字段正文渲染成文字条带：与段图文字带同款（无卡片底、无边框），按标点预断行", () => {
    // 一段 20 字无句读文案 + 显式标点文案：条带自带居中窄栏，断点跟标点走。
    const textOnlyBlocks: ContentBlock[] = [
      { id: "s1", type: "image", content: "/api/image-assets/strip-1/content", altText: "段图", order: 0, version: 1 },
      {
        id: "plain-1",
        type: "paragraph",
        content: "雾蒙蒙的清晨小鹿踩着露水走进森林深处寻找蘑菇",
        order: 1,
        version: 1
      },
      { id: "s2", type: "image", content: "/api/image-assets/strip-2/content", altText: "段图", order: 2, version: 1 }
    ];
    const html = renderWechatStripFlowHtml(textOnlyBlocks, assets, "ink", {
      plainTextBlockIds: new Set(["plain-1"])
    });

    // 条带视觉：与段图文字带同一形态——内容区宽占比 91%、居中、**无背景无边框**
    // （2026-09-21 用户拍板「去除段中的边框和文字背景」，段图渲染器同步去卡）。
    expect(html).toContain("width:91%");
    expect(html).toContain("text-align:center");
    expect(html).not.toContain("background:#FCFAF4");
    expect(html).not.toContain("border:2px solid #E8E1D2");
    // 13 字预算下 21 字文案断成两行，行间用 <br>，断行由服务端预排。
    expect(html).toContain("<br>");
    expect(html).toContain("雾蒙蒙的清晨小鹿踩着露水");
  });

  it("预览模式（includeResidualText）下纯文字段同样是文字条带，残留块仍是普通段落", () => {
    const html = renderWechatStripFlowHtml(
      [
        ...blocks,
        { id: "plain-1", type: "paragraph", content: "纯文字段", order: 3, version: 1 }
      ],
      assets,
      "ink",
      { includeResidualText: true, plainTextBlockIds: new Set(["plain-1"]) }
    );

    // 纯文字段走条带；普通残留导语走通用 <p>。
    expect(html).toContain('style="margin:12px auto;width:91%');
    expect(html).toContain("纯文字段");
    expect(html).toContain('<p style="margin:0 0 18px;');
  });
});
