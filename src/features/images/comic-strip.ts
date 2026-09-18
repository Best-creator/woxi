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
  /**
   * 文字带的排版度量（像素，按画布宽度定）。
   *
   * 为什么必须能调：长图/段图在公众号里一律 100% 宽显示，1080 的画布落到手机正文
   * 只剩 340-400px，等于整体缩到约 0.32 倍。字号写死就等于把读者的最终观感写死——
   * 原来正文 32px 在手机上其实只有 ~10px（微信正文自身是 17px），读者反馈「看着很吃力」。
   * 所以基准值按缩放比反推（0.32 × 52 ≈ 17px），档位选择见 STORYBOARD_TEXT_SCALE_OPTIONS。
   */
  titleSize: number;
  titleLineHeight: number;
  bodySize: number;
  bodyLineHeight: number;
  /** 文字距卡片边缘的留白；注意不是画布留白（那是 padding）。 */
  textPadX: number;
  textPadY: number;
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
  // 字号基准按「手机正文里的实际观感」反推，不是按画布好看：
  // 1080 画布 → 手机正文约 340-400px，缩放 ≈ 0.32，所以 52px 正文 ≈ 17px 观感、
  // 64px 标题 ≈ 20px 观感，与微信正文（17px）同量级，读起来才不费劲。
  titleSize: 64,
  titleLineHeight: 88,
  bodySize: 52,
  bodyLineHeight: 76,
  textPadX: 48,
  textPadY: 44,
  background: "#FFFFFF",
  // 文字带是暖纸白卡片：纯白会「素得像没设计」，与精致的分镜插图落差太大；
  // 卡片底 + 细描边 + 圆角 + 硬阴影（见 TEXT_CARD_* 常量）让文字带成为
  // 长图里的杂志小节卡——比纯白有设计感，又足够浅，不破坏「一整张纸」的连续感。
  textBackground: "#FCFAF4",
  textColor: "#2C2C2A",
  // 标题用深绿呼应强调色：杂志小节标题的常规做法，黑标题在卡片上太闷。
  titleColor: "#1E5B37",
  accent: "#2F7D47",
  // 中文字体只列常见系统字体：微信侧和本机渲染都要能命中，不能依赖网络上没有的字库。
  fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
};

/**
 * 只缩放文字带（字号 / 行高 / 卡片内边距），画布宽度与分镜图尺寸不动。
 *
 * 段图的显示宽度由公众号正文决定（恒为 100%），所以「字看着更大」只有一条路：
 * 让文字占画布的比例更大。缩放系数来自作者选的档位，见 STORYBOARD_TEXT_SCALE_OPTIONS。
 */
export function scaleStripTextMetrics(
  metrics: ComicStripMetrics,
  scale: number
): ComicStripMetrics {
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return metrics;
  return {
    ...metrics,
    titleSize: Math.round(metrics.titleSize * scale),
    titleLineHeight: Math.round(metrics.titleLineHeight * scale),
    bodySize: Math.round(metrics.bodySize * scale),
    bodyLineHeight: Math.round(metrics.bodyLineHeight * scale),
    textPadX: Math.round(metrics.textPadX * scale),
    textPadY: Math.round(metrics.textPadY * scale)
  };
}

/** 标题与正文之间的小间隔：与字号同缩放，避免特大档下标题贴着正文。 */
function titleGap(metrics: ComicStripMetrics) {
  return Math.round(metrics.bodySize * 0.23);
}

// 文字卡片的固定视觉参数：不进 metrics——这是设计决策，不是可调参数。
const TEXT_CARD_BORDER = "#E8E1D2";
const TEXT_CARD_SHADOW = "#E7ECE3";
const TEXT_CARD_RADIUS = 16;
const TEXT_CARD_SHADOW_OFFSET = 5;

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
  // 预算扣掉阴影偏移：卡片本体比带子窄一拍，折行不能贴到阴影里去。
  const contentWidth =
    metrics.width - metrics.padding * 2 - metrics.textPadX * 2 - TEXT_CARD_SHADOW_OFFSET;
  const title = block.title?.trim() ?? "";
  const body = block.body.trim();
  const titleLines = title ? wrapText(title, contentWidth, metrics.titleSize) : [];
  const bodyLines = body ? wrapText(body, contentWidth, metrics.bodySize) : [];
  const height =
    metrics.textPadY * 2 +
    titleLines.length * metrics.titleLineHeight +
    (titleLines.length && bodyLines.length ? titleGap(metrics) : 0) +
    bodyLines.length * metrics.bodyLineHeight;

  return { titleLines, bodyLines, width: metrics.width, height };
}

function renderComicStripTextBlockSvg(
  block: ComicStripTextBlock,
  metrics: ComicStripMetrics,
  layout: ComicStripTextLayout
) {
  // 这张 SVG 的坐标原点就是「内容区左边缘」：合成时整块被摆在 metrics.padding 处，
  // 所以这里绝不能再加一次 padding——加了文字会整体右移一拍，右侧就越出卡片边界
  // （左内边距看起来是两倍、右边却被压到边框上，实测满行会溢出 8px）。
  const blockWidth = metrics.width - metrics.padding * 2;
  const textLeft = metrics.textPadX;
  const parts: string[] = [];

  let y = metrics.textPadY;
  for (const line of layout.titleLines) {
    y += metrics.titleLineHeight;
    parts.push(
      `<text x="${textLeft}" y="${y}" font-family="${escapeXml(metrics.fontFamily)}" font-size="${metrics.titleSize}" font-weight="700" fill="${metrics.titleColor}">${escapeXml(line)}</text>`
    );
  }
  if (layout.titleLines.length && layout.bodyLines.length) y += titleGap(metrics);
  for (const line of layout.bodyLines) {
    y += metrics.bodyLineHeight;
    parts.push(
      `<text x="${textLeft}" y="${y}" font-family="${escapeXml(metrics.fontFamily)}" font-size="${metrics.bodySize}" fill="${metrics.textColor}">${escapeXml(line)}</text>`
    );
  }

  // 标题前的强调竖条：圆角短条只压在标题区，替代旧版「贯穿整块」的左边缘线——
  // 那条线把每段文案都框成引用体，杂志小节卡用短竖标更精神。
  // 几何全部从文字度量推导（比例与旧版写死值一致），换字号档位时竖条跟着长，
  // 不会出现「字大了、竖条还是细细一条」的错位。
  const barWidth = Math.max(6, Math.round(metrics.titleSize * 0.18));
  const titleBar = layout.titleLines.length
    ? `<rect x="${Math.round(metrics.textPadX * 0.4)}" y="${
        metrics.textPadY + Math.round(metrics.titleLineHeight * 0.14)
      }" width="${barWidth}" height="${
        layout.titleLines.length * metrics.titleLineHeight -
        Math.round(metrics.titleLineHeight * 0.18)
      }" rx="${barWidth / 2}" fill="${metrics.accent}"/>`
    : "";

  const cardWidth = blockWidth - TEXT_CARD_SHADOW_OFFSET;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidth}" height="${layout.height + TEXT_CARD_SHADOW_OFFSET}">
  <rect x="${TEXT_CARD_SHADOW_OFFSET}" y="${TEXT_CARD_SHADOW_OFFSET}" width="${cardWidth}" height="${layout.height}" rx="${TEXT_CARD_RADIUS}" fill="${TEXT_CARD_SHADOW}"/>
  <rect x="0" y="0" width="${cardWidth}" height="${layout.height}" rx="${TEXT_CARD_RADIUS}" fill="${metrics.textBackground}" stroke="${TEXT_CARD_BORDER}" stroke-width="2"/>
  ${titleBar}
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
  return {
    input: binary,
    width: layout.width - metrics.padding * 2,
    height: layout.height + TEXT_CARD_SHADOW_OFFSET
  };
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
