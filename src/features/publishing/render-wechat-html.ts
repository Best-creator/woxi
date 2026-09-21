import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
// 断行算法必须从 text-wrap 直取：本模块被客户端组件（wechat-preview）引用，
// 走 comic-strip 的 re-export 会把 sharp 整棵拖进浏览器 bundle（Module not found: fs）。
import {
  TEXT_BAND_MAX_CHARS_PER_LINE,
  wrapText
} from "@/features/images/text-wrap";
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

// 纯文字段（text_only）正文条带的固定视觉参数：**按段图文字带的几何等比折算**，
// 不是独立设计（2026-09-21 用户拍板：四个路由的文字必须是同一种「段」的形态）。
// 段图文字带（comic-strip.ts）：画布 1080、内容区 984（占 91%）、字号 52、行高 76、
// 内边距 48×44、圆角 16；段图在正文里恒 100% 宽，手机 ~375px 时缩放 ≈0.347，
// 等比观感 = 字号 18px / 行高 26px / 内边距 17×15px / 圆角 6px——条带照抄这套折算值，
// 手机上与段图里的文字带几乎无差。配色不进主题：段图是固定色烘死的像素，
// 条带跟着主题换色反而会与上下段图脱节。微信粘贴过滤 box-shadow，硬阴影省略。
const PLAIN_TEXT_CARD_BACKGROUND = "#FCFAF4";
const PLAIN_TEXT_CARD_BORDER = "#E8E1D2";
const PLAIN_TEXT_CARD_TEXT = "#2C2C2A";
const PLAIN_TEXT_CARD_FONT_SIZE = 18;
const PLAIN_TEXT_CARD_LINE_HEIGHT = 26;

/**
 * 纯文字段（text_only）的正文条带：与段图里的文字带**同一种段的形态**。
 *
 * 「图+文+图」里的文是段图内容区里的一条暖纸白带（占画布 91%、文字居中、13 字/行）；
 * 纯文字段不拼图，这条带直接以 HTML 复刻进正文流——宽度 91%（与段图内容区同比例）、
 * 断行复用段图同一套 wrapText 三步算法与 13 字口径，「四个路由里的文字按标点换行」
 * 由此全覆盖。服务端预断行后任何屏宽下断点一致，不依赖客户端的自动折行。
 */
function renderPlainTextCard(block: ContentBlock) {
  const lines = wrapText(
    block.content,
    TEXT_BAND_MAX_CHARS_PER_LINE * PLAIN_TEXT_CARD_FONT_SIZE,
    PLAIN_TEXT_CARD_FONT_SIZE
  );
  const body = lines.map((line) => escapeHtml(line)).join("<br>");
  return `<section style="margin:12px auto;width:91%;max-width:616px;box-sizing:border-box;padding:15px 17px;background:${PLAIN_TEXT_CARD_BACKGROUND};border:2px solid ${PLAIN_TEXT_CARD_BORDER};border-radius:6px;text-align:center;"><p style="margin:0;color:${PLAIN_TEXT_CARD_TEXT};font-size:${PLAIN_TEXT_CARD_FONT_SIZE}px;line-height:${PLAIN_TEXT_CARD_LINE_HEIGHT}px;">${body}</p></section>`;
}

function renderBlock(block: ContentBlock, theme: WechatTheme) {  switch (block.type) {
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
 * 纯段图流渲染：正文 = 一串段图（每段一张，文字已烘进图里）+ 纯文字段的正文图文。
 *
 * 与 renderWechatHtml 的差异：
 * - 只输出「指向已生成段图资产」的 image 块，且**不带 figcaption**——
 *   段图的 altText（「文章标题｜段图｜段标题」）是给无障碍用的，不该印在读者眼前；
 * - 不属于任何段的残留块默认不渲染（推送门会先拦下并要求作者处理）；
 *   作者确认保留（force）后按通用块渲染，插在段图之间；
 * - 纯文字段（text_only）的文案块**始终渲染**——它们不是残留块，而是设计出来的
 *   「段图之间的图文」，由 plainTextBlockIds 显式点名（推送门与预览共用）。
 * 预览与推送共用本函数，保证所见即所推。
 */
export function renderWechatStripFlowHtml(
  blocks: readonly ContentBlock[],
  assets: readonly ImageAsset[],
  themeId: ThemeId,
  options: {
    includeResidualText?: boolean;
    /** 始终渲染的正文块 id（纯文字段的文案块）；预览侧也可不传——它本来就把全部文本渲染出来。 */
    plainTextBlockIds?: ReadonlySet<string>;
  } = {}
) {
  const theme = WECHAT_THEMES[themeId];
  const stripUrls = new Set(
    assets
      .filter((asset) => asset.type === "comic_strip" && asset.status === "generated")
      .map((asset) => `/api/image-assets/${asset.id}/content`)
  );
  const plainTextBlockIds = options.plainTextBlockIds;
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
      const isPlainText = Boolean(plainTextBlockIds?.has(block.id));
      // 纯文字段的段落块渲染成文字卡（与段图文字带同款）；heading 等其他块照旧。
      if (isPlainText && block.type === "paragraph") return renderPlainTextCard(block);
      const renderText = options.includeResidualText || isPlainText;
      return renderText ? renderBlock(block, theme) : "";
    })
    .join("");
  return `<section style="box-sizing:border-box;margin:0 auto;max-width:677px;padding:24px 18px;background:${theme.background};font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0;">${content}</section>`;
}
