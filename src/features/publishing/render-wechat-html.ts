import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { WECHAT_THEMES, type ThemeId, type WechatTheme } from "./themes";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function withBreaks(value: string) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function validImageSource(value: string) {
  if (/^\/api\/image-assets\/[A-Za-z0-9-]+\/content$/.test(value)) {
    return value;
  }
  if (/["'\u0000-\u001F\u007F]/.test(value)) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderKnowledgeCard(block: ContentBlock, theme: WechatTheme) {
  const [title = "知识卡片", ...lines] = block.content.split("\n");
  const items = lines
    .filter(Boolean)
    .map(
      (line) =>
        `<div style="border-top:1px solid ${theme.border};padding:10px 0 0;color:${theme.text};font-size:14px;line-height:1.75;">${withBreaks(line)}</div>`
    )
    .join("");
  return `<section style="display:grid;gap:10px;margin:24px 0;padding:18px 20px;background:${theme.surface};border:1px solid ${theme.border};border-left:4px solid ${theme.accent};"><strong style="color:${theme.accent};font-size:16px;line-height:1.5;">${escapeHtml(title)}</strong>${items}</section>`;
}

function renderBlock(block: ContentBlock, theme: WechatTheme) {
  switch (block.type) {
    case "heading": {
      const level = block.level ?? 2;
      const tag = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
      const fontSize = level === 1 ? "25px" : level === 3 ? "17px" : "20px";
      return `<${tag} style="margin:${level === 1 ? "10px 0 28px" : "34px 0 14px"};color:${theme.text};font-size:${fontSize};font-weight:700;line-height:1.45;">${withBreaks(block.content)}</${tag}>`;
    }
    case "paragraph":
      return `<p style="margin:0 0 18px;color:${theme.text};font-size:16px;line-height:1.9;text-align:justify;">${withBreaks(block.content)}</p>`;
    case "quote":
      return `<blockquote style="margin:24px 0;padding:12px 18px;border-left:3px solid ${theme.accent};background:${theme.surface};color:${theme.muted};font-size:15px;line-height:1.8;">${withBreaks(block.content)}</blockquote>`;
    case "callout":
      return `<section style="margin:26px 0;padding:16px 18px;border:1px solid ${theme.border};background:${theme.surface};color:${theme.text};font-size:15px;line-height:1.8;"><strong style="color:${theme.accent};">要点</strong><br>${withBreaks(block.content)}</section>`;
    case "knowledge_card":
      return renderKnowledgeCard(block, theme);
    case "image": {
      const url = validImageSource(block.content);
      const alt = escapeHtml(block.altText || "文章配图");
      return url
        ? `<figure style="margin:26px 0;"><img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" style="display:block;width:100%;max-width:100%;height:auto;"><figcaption style="margin-top:8px;color:${theme.muted};font-size:12px;line-height:1.5;text-align:center;">${alt}</figcaption></figure>`
        : `<section style="margin:26px 0;padding:28px 18px;border:1px dashed ${theme.border};background:${theme.surface};color:${theme.muted};font-size:13px;text-align:center;">${alt}</section>`;
    }
  }
}

export function renderWechatHtml(
  blocks: readonly ContentBlock[],
  themeId: ThemeId
) {
  const theme = WECHAT_THEMES[themeId];
  const content = [...blocks]
    .sort((left, right) => left.order - right.order)
    .map((block) => renderBlock(block, theme))
    .join("");
  return `<section style="box-sizing:border-box;margin:0 auto;max-width:677px;padding:24px 18px;background:${theme.background};font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0;">${content}</section>`;
}

export function blocksToPlainText(blocks: readonly ContentBlock[]) {
  return [...blocks]
    .sort((left, right) => left.order - right.order)
    .map((block) =>
      block.type === "image" ? `[配图：${block.altText || "文章配图"}]` : block.content
    )
    .join("\n\n");
}

/**
 * 纯段图流渲染：正文 = 一串段图（每段一张，文字已烘进图里），没有可复制的正文文本。
 *
 * 与 renderWechatHtml 的差异：
 * - 只输出「指向已生成段图资产」的 image 块，且**不带 figcaption**——
 *   段图的 altText（「文章标题｜段图｜段标题」）是给无障碍用的，不该印在读者眼前；
 * - 不属于任何段的残留块默认不渲染（推送门会先拦下并要求作者处理）；
 *   作者确认保留（force）后按通用块渲染，插在段图之间。
 * 预览与推送共用本函数，保证所见即所推。
 */
export function renderWechatStripFlowHtml(
  blocks: readonly ContentBlock[],
  assets: readonly ImageAsset[],
  themeId: ThemeId,
  options: { includeResidualText?: boolean } = {}
) {
  const theme = WECHAT_THEMES[themeId];
  const stripUrls = new Set(
    assets
      .filter((asset) => asset.type === "comic_strip" && asset.status === "generated")
      .map((asset) => `/api/image-assets/${asset.id}/content`)
  );
  const content = [...blocks]
    .sort((left, right) => left.order - right.order)
    .map((block) => {
      if (block.type === "image" && stripUrls.has(block.content)) {
        const url = validImageSource(block.content);
        const alt = escapeHtml(block.altText || "段图");
        return url
          ? `<section style="margin:0;"><img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" style="display:block;width:100%;max-width:100%;height:auto;"></section>`
          : "";
      }
      return options.includeResidualText ? renderBlock(block, theme) : "";
    })
    .join("");
  return `<section style="box-sizing:border-box;margin:0 auto;max-width:677px;padding:24px 18px;background:${theme.background};font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0;">${content}</section>`;
}
