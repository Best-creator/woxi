import sharp from "sharp";
import type { SpeechLineKind } from "./domain";

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

/**
 * 帧的台词/旁白条（剧情漫画形态）：挂在帧后面的一小块横条。
 *
 * - narration（旁白）：橙底圆角条 + 固定头像位（红衣青年侧脸——混知式「作者画外音」）；
 * - dialogue（对白）：白底橙描边条，角色嘴里的短句。
 * 与「卡片段落」（text）的区别在形态与信息量：条是旁白式的一句话，卡才是知识本体。
 */
export interface ComicStripSpeechBlock {
  kind: "speech";
  speechKind: SpeechLineKind;
  text: string;
}

export type ComicStripBlock = ComicStripImageBlock | ComicStripTextBlock | ComicStripSpeechBlock;

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

/**
 * 分镜帧在段图画布内容区里的宽度占比（2026-09-20 从占满调小到 0.85）。
 *
 * 参考混知的图文比例：画面收窄居中、两侧留白，图不压文；文字带与台词条仍占满内容区，
 * 烘字的手机观感不受影响（这也是不在显示层缩图的原因——显示层缩会把烘字一起缩小，
 * 紧凑档会跌破 13px 的可读下限）。帧尺寸烘进了段图像素，改这个值必须重新拼接段图。
 */
export const STORYBOARD_PANEL_WIDTH_RATIO = 0.85;

/**
 * 正文断行的硬上限（每行全角字数）：混知式知识条漫的正文是**居中短行**，
 * 行宽一满整个卡片就退回「语文课本」。13 字 ≈ 手机宽度下两眼扫完一行。
 */
export const TEXT_BAND_MAX_CHARS_PER_LINE = 13;

// 台词/旁白条的固定视觉参数（橙条家族，与暖纸白文字卡同属一个设计语言）。
const SPEECH_BAR_RADIUS = 16;
const SPEECH_BAR_SHADOW_OFFSET = 5;
const SPEECH_NARRATION_BACKGROUND = "#FFB03A";
const SPEECH_NARRATION_BORDER = "#E8960F";
const SPEECH_NARRATION_TEXT = "#4A2B00";
const SPEECH_DIALOGUE_BACKGROUND = "#FFFFFF";
const SPEECH_DIALOGUE_BORDER = "#FFB03A";
const SPEECH_DIALOGUE_TEXT = "#3D2817";
// 旁白条左侧的固定头像位（红衣青年）：直径按正文字号推，字号档位变它跟着变。
const SPEECH_AVATAR_SIZE_RATIO = 2.1;
const SPEECH_AVATAR_SKIN = "#FFD9B3";
const SPEECH_AVATAR_HAIR = "#2A2A2A";
const SPEECH_AVATAR_SHIRT = "#C7331F";
const SPEECH_AVATAR_LINE = "#3D2817";

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
  // 正文是居中短行：即使卡片很宽，每行也最多 13 个全角字——行宽吃满就是课文脸。
  const bodyBudget = Math.min(contentWidth, metrics.bodySize * TEXT_BAND_MAX_CHARS_PER_LINE);
  const title = block.title?.trim() ?? "";
  const body = block.body.trim();
  const titleLines = title ? wrapText(title, contentWidth, metrics.titleSize) : [];
  const bodyLines = body ? wrapText(body, bodyBudget, metrics.bodySize) : [];
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
  // 正文居中（P3）：混知式短行从卡片中线向两边排，标题保持左对齐 + 竖条。
  const bodyCenterX = Math.round(blockWidth / 2);
  for (const line of layout.bodyLines) {
    y += metrics.bodyLineHeight;
    parts.push(
      `<text x="${bodyCenterX}" y="${y}" text-anchor="middle" font-family="${escapeXml(metrics.fontFamily)}" font-size="${metrics.bodySize}" fill="${metrics.textColor}">${escapeXml(line)}</text>`
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

export interface ComicStripSpeechLayout {
  lines: string[];
  /** 头像直径；对白条为 0。 */
  avatarSize: number;
  width: number;
  height: number;
}

/** 旁白条头像直径：正文字号 × 比例，字号档位变它跟着变。 */
function speechAvatarSize(metrics: ComicStripMetrics): number {
  return Math.round(metrics.bodySize * SPEECH_AVATAR_SIZE_RATIO);
}

/**
 * 台词条排版：文本折行预算要给旁白头像让位，条高取「文字高度」与「头像呼吸高度」的较大者。
 * 与文字卡同一套纯函数约定——高度直接决定长图尺寸，必须可钉死在测试里。
 */
export function layoutComicStripSpeechBlock(
  block: ComicStripSpeechBlock,
  metrics: ComicStripMetrics = DEFAULT_COMIC_STRIP_METRICS
): ComicStripSpeechLayout {
  const blockWidth = metrics.width - metrics.padding * 2 - SPEECH_BAR_SHADOW_OFFSET;
  const avatarSize = block.speechKind === "narration" ? speechAvatarSize(metrics) : 0;
  const avatarGap = avatarSize ? Math.round(metrics.bodySize * 0.45) : 0;
  const budget =
    blockWidth - metrics.textPadX * 2 - avatarSize - avatarGap;
  const lines = wrapText(block.text.trim(), budget, metrics.bodySize);
  const padY = Math.round(metrics.textPadY * 0.6);
  const textHeight = lines.length * metrics.bodyLineHeight;
  const height = Math.max(
    textHeight + padY * 2,
    avatarSize ? avatarSize + Math.round(metrics.textPadY * 0.4) : 0
  );
  return { lines, avatarSize, width: metrics.width, height };
}

/** 旁白条左侧的固定头像（红衣青年简笔）：脸 + 头发 + 五官 + 底部一截红衣。 */
function renderNarrationAvatarSvg(cx: number, cy: number, radius: number): string {
  const eyeOffsetX = Math.round(radius * 0.35);
  const eyeOffsetY = Math.round(radius * 0.08);
  const eyeRadius = Math.max(2, Math.round(radius * 0.09));
  return `
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${SPEECH_AVATAR_SKIN}" stroke="${SPEECH_AVATAR_LINE}" stroke-width="3"/>
  <ellipse cx="${cx}" cy="${Math.round(cy - radius * 0.5)}" rx="${Math.round(radius * 0.98)}" ry="${Math.round(radius * 0.5)}" fill="${SPEECH_AVATAR_HAIR}"/>
  <circle cx="${cx - eyeOffsetX}" cy="${cy + eyeOffsetY}" r="${eyeRadius}" fill="${SPEECH_AVATAR_LINE}"/>
  <circle cx="${cx + eyeOffsetX}" cy="${cy + eyeOffsetY}" r="${eyeRadius}" fill="${SPEECH_AVATAR_LINE}"/>
  <rect x="${Math.round(cx - radius * 0.22)}" y="${Math.round(cy + radius * 0.4)}" width="${Math.round(radius * 0.44)}" height="${Math.max(3, Math.round(radius * 0.1))}" rx="${Math.round(radius * 0.05)}" fill="${SPEECH_AVATAR_LINE}"/>
  <path d="M ${Math.round(cx - radius * 0.72)} ${cy + radius} L ${Math.round(cx - radius * 0.72)} ${Math.round(cy + radius * 0.62)} Q ${cx} ${Math.round(cy + radius * 0.38)} ${Math.round(cx + radius * 0.72)} ${Math.round(cy + radius * 0.62)} L ${Math.round(cx + radius * 0.72)} ${cy + radius} Z" fill="${SPEECH_AVATAR_SHIRT}"/>`;
}

function renderComicStripSpeechBlockSvg(
  block: ComicStripSpeechBlock,
  metrics: ComicStripMetrics,
  layout: ComicStripSpeechLayout
) {
  // 与文字卡同一条坐标约定：原点 = 内容区左边缘，不加 padding。
  const blockWidth = metrics.width - metrics.padding * 2;
  const isNarration = block.speechKind === "narration";
  const background = isNarration ? SPEECH_NARRATION_BACKGROUND : SPEECH_DIALOGUE_BACKGROUND;
  const border = isNarration ? SPEECH_NARRATION_BORDER : SPEECH_DIALOGUE_BORDER;
  const textColor = isNarration ? SPEECH_NARRATION_TEXT : SPEECH_DIALOGUE_TEXT;

  const cardWidth = blockWidth - SPEECH_BAR_SHADOW_OFFSET;
  const parts: string[] = [];

  // 文字在条内垂直居中；文本区（旁白 = 头像右侧，对白 = 整条）内水平居中。
  const textHeight = layout.lines.length * metrics.bodyLineHeight;
  const textTop = Math.round((layout.height - textHeight) / 2);
  let y = textTop;
  const avatarGap = layout.avatarSize ? Math.round(metrics.bodySize * 0.45) : 0;
  const textStartX = metrics.textPadX + layout.avatarSize + avatarGap;
  const centerX = Math.round((textStartX + cardWidth) / 2);
  for (const line of layout.lines) {
    y += metrics.bodyLineHeight;
    parts.push(
      `<text x="${centerX}" y="${y}" text-anchor="middle" font-family="${escapeXml(metrics.fontFamily)}" font-size="${metrics.bodySize}" font-weight="700" fill="${textColor}">${escapeXml(line)}</text>`
    );
  }

  const avatarSvg = layout.avatarSize
    ? renderNarrationAvatarSvg(
        metrics.textPadX + Math.round(layout.avatarSize / 2),
        Math.round(layout.height / 2),
        Math.round(layout.avatarSize / 2)
      )
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidth}" height="${layout.height + SPEECH_BAR_SHADOW_OFFSET}">
  <rect x="${SPEECH_BAR_SHADOW_OFFSET}" y="${SPEECH_BAR_SHADOW_OFFSET}" width="${cardWidth}" height="${layout.height}" rx="${SPEECH_BAR_RADIUS}" fill="${TEXT_CARD_SHADOW}"/>
  <rect x="0" y="0" width="${cardWidth}" height="${layout.height}" rx="${SPEECH_BAR_RADIUS}" fill="${background}" stroke="${border}" stroke-width="2"/>
  ${avatarSvg}
  ${parts.join("\n  ")}
</svg>`;
}

async function renderComicStripSpeechBlock(
  block: ComicStripSpeechBlock,
  metrics: ComicStripMetrics
): Promise<{ input: Buffer; width: number; height: number }> {
  const layout = layoutComicStripSpeechBlock(block, metrics);
  const svg = renderComicStripSpeechBlockSvg(block, metrics, layout);
  const binary = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    input: binary,
    width: layout.width - metrics.padding * 2,
    height: layout.height + SPEECH_BAR_SHADOW_OFFSET
  };
}

async function renderComicStripImageBlock(
  block: ComicStripImageBlock,
  metrics: ComicStripMetrics
): Promise<{ input: Buffer; width: number; height: number }> {
  const contentWidth = metrics.width - metrics.padding * 2;
  // 帧只占内容区的一部分（见 STORYBOARD_PANEL_WIDTH_RATIO），compose 阶段会按实际
  // 宽度居中摆放；高度上限同步收缩，让「宽撑满、高截断」的约束在新宽度下依然成立。
  // 文字带与台词条不经这里，仍占满内容区——图与文的视觉比例对齐混知式排版。
  const panelWidth = Math.round(contentWidth * STORYBOARD_PANEL_WIDTH_RATIO);
  const resized = await sharp(block.binary)
    .resize({
      width: panelWidth,
      height: Math.round(metrics.maxPanelHeight * STORYBOARD_PANEL_WIDTH_RATIO),
      fit: "inside"
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  return {
    input: resized,
    width: metadata.width ?? panelWidth,
    height: metadata.height ?? panelWidth
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
        : block.kind === "speech"
          ? await renderComicStripSpeechBlock(block, metrics)
          : await renderComicStripTextBlock(block, metrics);
    rendered.push({
      input: piece.input,
      // 图按实际缩放后的宽度居中；文字/台词条本身就是满宽，居中和左对齐等价。
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
