import sharp from "sharp";

/**
 * 把「分镜图」和「文字」烘进同一张长图。
 *
 * 为什么不直接在公众号里图文交替排？因为一图一文交替读起来还是「文章」，
 * 拼成一张图才是「漫画」——读者滑到这张图，眼睛会顺着一路看下去，不会停在文字上犹豫。
 * 代价是文字变成了像素，所以文字内容必须由调用方给出、并且不再在正文里重复出现。
 */

export interface ComicStripImageBlock {
  kind: "image";
  /** 分镜图的原始字节（PNG/JPEG/WebP 都吃）。 */
  binary: Buffer;
}

export interface ComicStripTextBlock {
  kind: "text";
  /** 这一格的标题，可缺省。 */
  title?: string;
  /** 这一格的文案。 */
  body: string;
}

export type ComicStripBlock = ComicStripImageBlock | ComicStripTextBlock;

export interface ComicStripMetrics {
  /** 画布宽度（微信正文安全宽度内，1080 是缩放进正文后仍清晰的下限）。 */
  width: number;
  /** 画布左右留白。 */
  padding: number;
  /** 单张分镜图的最大高度，防止一张竖图把整条长图撑到几千像素。 */
  maxPanelHeight: number;
  /** 块与块之间的间距。 */
  gap: number;
  background: string;
  textBackground: string;
  textColor: string;
  titleColor: string;
  accent: string;
  fontFamily: string;
}

export const DEFAULT_COMIC_STRIP_METRICS: ComicStripMetrics = {
  width: 1080,
  padding: 48,
  maxPanelHeight: 1180,
  gap: 28,
  background: "#FFFFFF",
  // 文字带和画布同色（纯白）：长图里每一格图片的底色都是白的，
  // 文字带要是留一块米灰，滑下来就像贴了一张便利贴，没法读成一整张纸。
  textBackground: "#FFFFFF",
  textColor: "#2C2C2A",
  titleColor: "#1A1A18",
  accent: "#2F7D47",
  // 中文字体只列常见系统字体：微信侧和本机渲染都要能命中，不能依赖网络上没有的字库。
  fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
};

const TITLE_SIZE = 40;
const TITLE_LINE_HEIGHT = 56;
const BODY_SIZE = 32;
const BODY_LINE_HEIGHT = 48;
const TEXT_PAD_X = 40;
const TEXT_PAD_Y = 32;

export interface ComicStripTextLayout {
  titleLines: string[];
  bodyLines: string[];
  width: number;
  height: number;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 单字符占宽（以字号为单位）。
 *
 * SVG 里没法在渲染前量文字宽度，所以按「全角算 1 个字、半角算 0.55 个」估算。
 * 中文正文几乎全是全角，这个近似足够稳；宁可略宽一点留白，也不要算窄了溢出画布。
 */
export function characterWidthRatio(character: string) {
  return /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
    character
  )
    ? 1
    : 0.55;
}

/**
 * 按像素宽度折行。显式换行符是硬换行，不参与宽度累加。
 *
 * 这是纯函数，因为「一格里到底几行」直接决定长图高度，必须能在测试里钉死。
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    let current = "";
    let currentWidth = 0;
    for (const character of Array.from(trimmed)) {
      const width = characterWidthRatio(character) * fontSize;
      // 行首不因为一个过宽的字符就空出一行：先落字再判断，超宽的单字符也自成一行。
      if (current && currentWidth + width > maxWidth) {
        lines.push(current);
        current = "";
        currentWidth = 0;
      }
      current += character;
      currentWidth += width;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [" "];
}

/** 文字块的排版结果：行内容 + 整块尺寸。渲染和高度累加共用它，避免两处各算一遍。 */
export function layoutComicStripTextBlock(
  block: ComicStripTextBlock,
  metrics: ComicStripMetrics = DEFAULT_COMIC_STRIP_METRICS
): ComicStripTextLayout {
  const contentWidth = metrics.width - metrics.padding * 2 - TEXT_PAD_X * 2;
  const title = block.title?.trim() ?? "";
  const body = block.body.trim();
  const titleLines = title ? wrapText(title, contentWidth, TITLE_SIZE) : [];
  const bodyLines = body ? wrapText(body, contentWidth, BODY_SIZE) : [];
  const height =
    TEXT_PAD_Y * 2 +
    titleLines.length * TITLE_LINE_HEIGHT +
    (titleLines.length && bodyLines.length ? 12 : 0) +
    bodyLines.length * BODY_LINE_HEIGHT;

  return { titleLines, bodyLines, width: metrics.width, height };
}

function renderComicStripTextBlockSvg(
  block: ComicStripTextBlock,
  metrics: ComicStripMetrics,
  layout: ComicStripTextLayout
) {
  const left = metrics.padding;
  const blockWidth = metrics.width - metrics.padding * 2;
  const textLeft = left + TEXT_PAD_X;
  const parts: string[] = [];

  let y = TEXT_PAD_Y;
  for (const line of layout.titleLines) {
    y += TITLE_LINE_HEIGHT;
    parts.push(
      `<text x="${textLeft}" y="${y}" font-family="${escapeXml(metrics.fontFamily)}" font-size="${TITLE_SIZE}" font-weight="700" fill="${metrics.titleColor}">${escapeXml(line)}</text>`
    );
  }
  if (layout.titleLines.length && layout.bodyLines.length) y += 12;
  for (const line of layout.bodyLines) {
    y += BODY_LINE_HEIGHT;
    parts.push(
      `<text x="${textLeft}" y="${y}" font-family="${escapeXml(metrics.fontFamily)}" font-size="${BODY_SIZE}" fill="${metrics.textColor}">${escapeXml(line)}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidth}" height="${layout.height}">
  <rect width="${blockWidth}" height="${layout.height}" fill="${metrics.textBackground}"/>
  <rect x="0" y="0" width="6" height="${layout.height}" fill="${metrics.accent}"/>
  ${parts.join("\n  ")}
</svg>`;
}

async function renderComicStripTextBlock(
  block: ComicStripTextBlock,
  metrics: ComicStripMetrics
): Promise<{ input: Buffer; width: number; height: number }> {
  const layout = layoutComicStripTextBlock(block, metrics);
  const svg = renderComicStripTextBlockSvg(block, metrics, layout);
  const binary = await sharp(Buffer.from(svg)).png().toBuffer();
  return { input: binary, width: layout.width - metrics.padding * 2, height: layout.height };
}

async function renderComicStripImageBlock(
  block: ComicStripImageBlock,
  metrics: ComicStripMetrics
): Promise<{ input: Buffer; width: number; height: number }> {
  const contentWidth = metrics.width - metrics.padding * 2;
  const resized = await sharp(block.binary)
    .resize({ width: contentWidth, height: metrics.maxPanelHeight, fit: "inside" })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  return {
    input: resized,
    width: metadata.width ?? contentWidth,
    height: metadata.height ?? contentWidth
  };
}

export interface ComposeComicStripResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * 按给定顺序把块竖着拼成一张长图。
 *
 * 块的顺序由调用方决定（也就是用户选的那种排法），这里只负责「渲染 + 竖向堆叠」，
 * 不判断哪张图配哪段字——那是排版规则的事，混在一起就没法单独测。
 */
export async function composeComicStrip(
  blocks: readonly ComicStripBlock[],
  metrics: ComicStripMetrics = DEFAULT_COMIC_STRIP_METRICS
): Promise<ComposeComicStripResult> {
  if (!blocks.length) throw new Error("拼图至少需要一个块");

  const rendered: Array<{ input: Buffer; left: number; top: number }> = [];
  let cursor = metrics.padding;

  for (const block of blocks) {
    const piece =
      block.kind === "image"
        ? await renderComicStripImageBlock(block, metrics)
        : await renderComicStripTextBlock(block, metrics);
    rendered.push({
      input: piece.input,
      // 图按实际缩放后的宽度居中；文字块本身就是满宽，居中和左对齐等价。
      left: metrics.padding + Math.max(0, Math.round((metrics.width - metrics.padding * 2 - piece.width) / 2)),
      top: cursor
    });
    cursor += piece.height + metrics.gap;
  }

  const height = cursor - metrics.gap + metrics.padding;
  const buffer = await sharp({
    create: {
      width: metrics.width,
      height,
      channels: 4,
      background: metrics.background
    }
  })
    .composite(rendered)
    .png()
    .toBuffer();

  return { buffer, width: metrics.width, height };
}
