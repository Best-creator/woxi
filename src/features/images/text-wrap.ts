/**
 * 段图文字的断行算法——独立成模块的原因是**依赖边界**，不是代码组织：
 *
 * `comic-strip.ts` 顶部 import sharp（像素合成必须跑在 Node），而预览与发布渲染
 * （`render-wechat-html.ts`）是客户端组件——从 comic-strip 取 wrapText 会把整棵
 * sharp 模块树拖进浏览器 bundle（detect-libc require('fs') 直接炸 Module not found）。
 * 所以纯文本断行（无任何 Node 依赖）住在这里；comic-strip re-export 保持既有
 * import 路径兼容，客户端渲染器必须从本模块直取。
 */

/**
 * 正文断行的硬上限（每行全角字数）：混知式知识条漫的正文是**居中短行**，
 * 行宽一满整个卡片就退回「语文课本」。13 字 ≈ 手机宽度下两眼扫完一行。
 */
export const TEXT_BAND_MAX_CHARS_PER_LINE = 13;

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
 * 按像素宽度折行；显式换行符是硬换行，不参与宽度累加。
 *
 * 2026-09-21 重写（修用户反馈的「换行没啥逻辑」）。旧实现是纯贪心按宽折行——
 * 30 字的长句在 13 字预算下断在任意位置，标点被拦腰截断、还常留 1-2 个字的孤行。
 * 现在分三步：
 *
 * 1. **句读优先**：先按断行点（。！？；：，、…与收尾引号括号）把文本切成
 *    「断行单元」，行与行优先落在句读上——换行跟着语义走；
 * 2. **禁则**：收尾标点不落行首（并回前一个单元），开引号/开括号不挂行尾
 *    （贪心兜底断行时挪到下一行）；
 * 3. **孤行平衡**：末行只剩 1-2 个全角字时，在末两行之间重找断点——
 *    优先句读位置，没有句读才按宽度均分；两行都放得下才生效。
 *
 * 行宽上限、超宽单字符自成一行、空文本给单空格占位这些旧语义一个都没动。
 * 这是纯函数：行数直接决定长图高度，必须在测试里钉死。
 */

/** 这些字符之后允许换行：句读与收尾引号/括号。 */
const BREAK_AFTER = new Set([
  "\u3002", "\uFF01", "\uFF1F", "\uFF1B", "\uFF1A", "\uFF0C", "\u3001", "\u2026", "\u2014",
  "\u300D", "\u300F", "\uFF09", "\u3011", "\u300B", "\u3009", "\u201D", "\u2019",
  "!", "?", ";", ":", ","
]);

/** 行首禁则：这些字符不落到行首（拆单元时并回前一个单元）。 */
const LINE_START_FORBIDDEN = new Set([
  "\u3001", "\u3002", "\uFF0C", "\uFF01", "\uFF1F", "\uFF1B", "\uFF1A", "\u2026", "\u2014",
  "\u300D", "\u300F", "\uFF09", "\u3011", "\u300B", "\u3009", "\u201D", "\u2019", "\u00B7"
]);

/** 行尾禁则：开引号/开括号不留在行尾（贪心兜底断行时挪到下一行）。 */
const LINE_END_FORBIDDEN = new Set([
  "\u300C", "\u300E", "\uFF08", "\u3010", "\u300A", "\u201C", "\u2018"
]);

/** 末行少于等于 2 个全角字宽视为孤行，触发末两行重排。 */
const ORPHAN_LINE_WIDTH_IN_CHARS = 2;

function textWidth(text: string, fontSize: number): number {
  let total = 0;
  for (const character of Array.from(text)) {
    total += characterWidthRatio(character) * fontSize;
  }
  return total;
}

/** 按句读把一段文本切成断行单元；单元若以收尾标点开头，并回前一个单元。 */
function breakUnits(paragraph: string): string[] {
  const raw: string[] = [];
  let current = "";
  for (const character of Array.from(paragraph)) {
    current += character;
    if (BREAK_AFTER.has(character)) {
      raw.push(current);
      current = "";
    }
  }
  if (current) raw.push(current);
  const units: string[] = [];
  for (const unit of raw) {
    if (units.length && LINE_START_FORBIDDEN.has(unit.charAt(0))) {
      units[units.length - 1] += unit;
      continue;
    }
    units.push(unit);
  }
  return units;
}

/** 贪心兜底：没有句读可借力的超宽单元按宽度硬切；行尾不挂开引号、行首不落收尾标点。 */
function chunkOversized(unit: string, maxWidth: number, fontSize: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const character of Array.from(unit)) {
    const width = characterWidthRatio(character) * fontSize;
    if (current && currentWidth + width > maxWidth) {
      // 断行前的禁则整理，两条都在落字前做完：
      // - 行尾禁则：开引号/开括号不孤悬行尾，跟下一个字去新行；
      // - 行首禁则：收尾标点不落新行行首，从当前行尾带一个字陪它。
      let carried = "";
      while (current && LINE_END_FORBIDDEN.has(current.slice(-1))) {
        carried = current.slice(-1) + carried;
        current = current.slice(0, -1);
        currentWidth -= fontSize;
      }
      if (LINE_START_FORBIDDEN.has(character) && current) {
        carried = current.slice(-1) + carried;
        current = current.slice(0, -1);
      }
      if (current) chunks.push(current);
      current = carried;
      currentWidth = textWidth(carried, fontSize);
    }
    current += character;
    currentWidth += width;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [unit];
}

/**
 * 末两行重排：在两行合计文本里重找断点，两行尽量均衡。
 * 候选断点统一打分（差值越小越均衡），非句读断点加「两字宽」的罚分——
 * 句读断点在均衡度接近时胜出（换行跟语义走），但不会为一句读制造 8 字 vs 2 字的失衡。
 * 断点必须让两行都不超宽，且不得违反行首/行尾禁则。找不到就原样返回。
 */
function balanceLastTwoLines(
  head: string,
  tail: string,
  maxWidth: number,
  fontSize: number
): [string, string] {
  const combined = Array.from(head + tail);
  const prefixWidths: number[] = [0];
  for (let index = 0; index < combined.length; index += 1) {
    prefixWidths.push(
      prefixWidths[index]! + characterWidthRatio(combined[index]!) * fontSize
    );
  }
  const total = prefixWidths[combined.length]!;
  let best: { at: number; score: number } | null = null;
  for (let at = 1; at < combined.length; at += 1) {
    const headWidth = prefixWidths[at]!;
    const tailWidth = total - headWidth;
    if (headWidth > maxWidth || tailWidth > maxWidth) continue;
    if (LINE_END_FORBIDDEN.has(combined[at - 1]!)) continue;
    if (LINE_START_FORBIDDEN.has(combined[at]!)) continue;
    const penalty = BREAK_AFTER.has(combined[at - 1]!)
      ? 0
      : ORPHAN_LINE_WIDTH_IN_CHARS * fontSize;
    const score = Math.abs(headWidth - tailWidth) + penalty;
    if (!best || score < best.score) best = { at, score };
  }
  if (!best) return [head, tail];
  return [combined.slice(0, best.at).join(""), combined.slice(best.at).join("")];
}

export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // 句读切元 + 超宽单元的贪心兜底细分，得到一串「放得下或自成一行」的单元。
    const units: string[] = [];
    for (const unit of breakUnits(trimmed)) {
      if (textWidth(unit, fontSize) <= maxWidth) {
        units.push(unit);
        continue;
      }
      units.push(...chunkOversized(unit, maxWidth, fontSize));
    }

    // 贪心装箱：单元依次进当前行，放不下就断行。
    // 行首不因为一个过宽的字符就空出一行：先落字再判断。
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentWidth = 0;
    for (const unit of units) {
      const width = textWidth(unit, fontSize);
      if (currentRow.length && currentWidth + width > maxWidth) {
        rows.push(currentRow);
        currentRow = [];
        currentWidth = 0;
      }
      currentRow.push(unit);
      currentWidth += width;
    }
    if (currentRow.length) rows.push(currentRow);

    // 孤行平衡：末行太短时在末两行之间重找断点（不改变总行数）。
    if (rows.length >= 2) {
      const tailRow = rows[rows.length - 1]!;
      const tailWidth = textWidth(tailRow.join(""), fontSize);
      if (tailWidth <= ORPHAN_LINE_WIDTH_IN_CHARS * fontSize) {
        const headRow = rows[rows.length - 2]!;
        const [head, tail] = balanceLastTwoLines(
          headRow.join(""),
          tailRow.join(""),
          maxWidth,
          fontSize
        );
        rows.splice(rows.length - 2, 2, [head], [tail]);
      }
    }

    for (const row of rows) lines.push(row.join(""));
  }
  return lines.length ? lines : [" "];
}
