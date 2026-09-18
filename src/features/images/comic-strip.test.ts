// @vitest-environment node

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMIC_STRIP_METRICS,
  characterWidthRatio,
  composeComicStrip,
  layoutComicStripTextBlock,
  scaleStripTextMetrics,
  wrapText,
  type ComicStripMetrics
} from "./comic-strip";

/** 小画布跑得快，算出来的尺寸又和真实画布同一套公式。 */
const METRICS: ComicStripMetrics = {
  ...DEFAULT_COMIC_STRIP_METRICS,
  width: 400,
  padding: 20,
  maxPanelHeight: 300,
  gap: 10
};

function solidPanel(width = 400, height = 300, background = "#3366ff") {
  return sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
}

describe("characterWidthRatio", () => {
  it("treats CJK as full width and Latin as roughly half", () => {
    expect(characterWidthRatio("字")).toBe(1);
    expect(characterWidthRatio("，")).toBe(1);
    expect(characterWidthRatio("a")).toBe(0.55);
  });
});

describe("wrapText", () => {
  it("breaks a CJK line at the width budget", () => {
    // 32px 字号、40px 宽的预算 → 一行只放得下 1 个字。
    expect(wrapText("一二三四", 40, 32)).toEqual(["一", "二", "三", "四"]);
  });

  it("fits the number of characters the width allows", () => {
    const lines = wrapText("一二三四五六七八九十", 320, 32);

    expect(lines).toHaveLength(1);
    expect(wrapText("一二三四五六七八九十十一", 320, 32)).toHaveLength(2);
  });

  it("honours explicit newlines as hard breaks", () => {
    expect(wrapText("第一行\n第二行", 320, 32)).toEqual(["第一行", "第二行"]);
  });

  it("drops blank lines instead of emitting empty text nodes", () => {
    expect(wrapText("上\n\n\n下", 320, 32)).toEqual(["上", "下"]);
  });

  it("still returns one line for whitespace-only input", () => {
    // SVG 里没有 <text> 就会变成空块，高度算错；给一个空格占位最省事。
    expect(wrapText("   ", 320, 32)).toEqual([" "]);
  });
});

describe("layoutComicStripTextBlock", () => {
  it("grows with the number of wrapped lines", () => {
    const short = layoutComicStripTextBlock({ kind: "text", body: "一句话" }, METRICS);
    const long = layoutComicStripTextBlock({ kind: "text", body: "一句话".repeat(12) }, METRICS);

    expect(long.height).toBeGreaterThan(short.height);
    expect(short.titleLines).toEqual([]);
  });

  it("gives a titled band more height than a bare caption", () => {
    const bare = layoutComicStripTextBlock({ kind: "text", body: "文案" }, METRICS);
    const titled = layoutComicStripTextBlock({ kind: "text", title: "第一格", body: "文案" }, METRICS);

    expect(titled.titleLines).toEqual(["第一格"]);
    expect(titled.height).toBeGreaterThan(bare.height);
  });
});

describe("composeComicStrip", () => {
  it("stacks the blocks, keeps the canvas width, and returns a real PNG", async () => {
    const text = { kind: "text" as const, title: "第一格", body: "盯着屏幕时眨眼次数掉了一半。" };
    const { buffer, width, height } = await composeComicStrip(
      [
        { kind: "image", binary: await solidPanel() },
        text,
        { kind: "image", binary: await solidPanel() }
      ],
      METRICS
    );

    expect(width).toBe(METRICS.width);
    // 两张图各被压到 (400-40) 宽、300 高上限内 → 360×270；中间那块按排版算出的高度，
    // 外加文字卡右下的 5px 硬阴影（卡片化后文字带实际占位多出一拍）。
    const textHeight = layoutComicStripTextBlock(text, METRICS).height + 5;
    expect(height).toBe(METRICS.padding * 2 + METRICS.gap * 2 + 270 * 2 + textHeight);

    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(METRICS.width);
    expect(metadata.height).toBe(height);
  });

  it("paints the padding with the canvas background so the strip has clean margins", async () => {
    const { buffer, height } = await composeComicStrip(
      [{ kind: "image", binary: await solidPanel() }],
      METRICS
    );
    const { data, info } = await sharp(buffer)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(height).toBeGreaterThan(0);
    // 左上角落在 padding 里，应该是白的。
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
    expect(info.channels).toBeGreaterThanOrEqual(3);
  });

  it("fills the text band with the warm card background", async () => {
    const { buffer } = await composeComicStrip([{ kind: "text", body: "一句话" }], METRICS);
    // 取文字带右侧、文字够不到的一点：那里是文字卡的底色而不是画布。
    // 卡片化后底色是暖纸白 #FCFAF4——比纯白暖一点，给文字带「杂志小节卡」的质感。
    const { data } = await sharp(buffer)
      .extract({ left: METRICS.width - 30, top: METRICS.padding + 8, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect([data[0], data[1], data[2]]).toEqual([252, 250, 244]);
  });

  it("keeps the copy inside its text card instead of bleeding past the border", async () => {
    // 回归：文字块 SVG 的坐标原点就是内容区左边缘，早先又加了一次 metrics.padding，
    // 于是文字整体右移一拍——左侧内边距看着是两倍、右侧则压到卡片边框上。
    // 默认画布（padding 48 > 文字内边距 40）下满行会溢出 8px，这一段就是钉住它的。
    const metrics = DEFAULT_COMIC_STRIP_METRICS;
    const body =
      "机会成本不是账面上的钱，而是你为了做这件事、不得不放弃的那件最值钱的事。它平时不出现，只在选择的那一刻才浮出水面。";
    const { buffer, width } = await composeComicStrip(
      [{ kind: "text", title: "机会成本是什么", body }],
      metrics
    );

    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    let leftmost = info.width;
    let rightmost = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const at = (y * info.width + x) * info.channels;
        const r = data[at]!;
        const g = data[at + 1]!;
        const b = data[at + 2]!;
        // 只认正文字色 #2C2C2A（亮度约 43）：卡片底/边框/阴影都更亮，
        // 标题竖条 #2F7D47 亮度约 81 也会被这个阈值挡在外面。
        if ((r + g + b) / 3 < 60) {
          leftmost = Math.min(leftmost, x);
          rightmost = Math.max(rightmost, x);
        }
      }
    }

    const cardLeft = metrics.padding;
    const cardRight = metrics.padding + (width - metrics.padding * 2) - 5;
    expect(leftmost).toBeGreaterThanOrEqual(cardLeft + 30);
    // 关键断言：文字不得越过卡片本体右边缘（修之前这里是 1030 > 1027）。
    expect(rightmost).toBeLessThanOrEqual(cardRight - 25);
  });

  it("caps a tall panel so one竖图 cannot blow the strip up", async () => {
    const tall = await solidPanel(400, 2000);
    const { height } = await composeComicStrip([{ kind: "image", binary: tall }], METRICS);

    // 2000 高的竖图被压到 maxPanelHeight=300：整条长图正好是「上下留白 + 300」。
    expect(height).toBe(METRICS.padding * 2 + METRICS.maxPanelHeight);
    // 不封顶的话按宽度等比缩放会得到 1800 高，这条断言就是用来盯住这个上限的。
    expect(height).toBeLessThan(400);
  });

  it("refuses an empty strip instead of writing a blank image", async () => {
    await expect(composeComicStrip([], METRICS)).rejects.toThrow("拼图至少需要一个块");
  });
});

describe("scaleStripTextMetrics", () => {
  it("scales only the text band and leaves the canvas geometry alone", () => {
    const scaled = scaleStripTextMetrics(DEFAULT_COMIC_STRIP_METRICS, 1.2);

    // 画布宽度、图片内边距、段间距都不动：放大的只是「文字占画布的比例」。
    expect(scaled.width).toBe(DEFAULT_COMIC_STRIP_METRICS.width);
    expect(scaled.padding).toBe(DEFAULT_COMIC_STRIP_METRICS.padding);
    expect(scaled.gap).toBe(DEFAULT_COMIC_STRIP_METRICS.gap);
    expect(scaled.maxPanelHeight).toBe(DEFAULT_COMIC_STRIP_METRICS.maxPanelHeight);
    expect(scaled.fontFamily).toBe(DEFAULT_COMIC_STRIP_METRICS.fontFamily);
    // 正文与标题同步放大，行高跟着走，否则行会挤在一起。
    expect(scaled.bodySize).toBeGreaterThan(DEFAULT_COMIC_STRIP_METRICS.bodySize);
    expect(scaled.titleSize).toBeGreaterThan(DEFAULT_COMIC_STRIP_METRICS.titleSize);
    expect(scaled.bodyLineHeight).toBeGreaterThan(DEFAULT_COMIC_STRIP_METRICS.bodyLineHeight);
    expect(scaled.textPadY).toBeGreaterThan(DEFAULT_COMIC_STRIP_METRICS.textPadY);
    expect(scaled.bodyLineHeight / scaled.bodySize).toBeCloseTo(
      DEFAULT_COMIC_STRIP_METRICS.bodyLineHeight / DEFAULT_COMIC_STRIP_METRICS.bodySize,
      1
    );
  });

  it("returns the same object for the neutral and nonsensical scales", () => {
    // 1 与非法值都原样返回：调用点不用自己分支，也避免每次渲染换新对象。
    expect(scaleStripTextMetrics(DEFAULT_COMIC_STRIP_METRICS, 1)).toBe(
      DEFAULT_COMIC_STRIP_METRICS
    );
    expect(scaleStripTextMetrics(DEFAULT_COMIC_STRIP_METRICS, 0)).toBe(
      DEFAULT_COMIC_STRIP_METRICS
    );
    expect(scaleStripTextMetrics(DEFAULT_COMIC_STRIP_METRICS, -1)).toBe(
      DEFAULT_COMIC_STRIP_METRICS
    );
    expect(scaleStripTextMetrics(DEFAULT_COMIC_STRIP_METRICS, Number.NaN)).toBe(
      DEFAULT_COMIC_STRIP_METRICS
    );
  });

  it("lays out a scaled text block taller than the unscaled one", () => {
    const scaled = scaleStripTextMetrics(METRICS, 1.2);
    const block = { kind: "text" as const, title: "标题", body: "一段正文文案。" };

    const plain = layoutComicStripTextBlock(block, METRICS);
    const bigger = layoutComicStripTextBlock(block, scaled);

    // 行高与内边距一起放大 → 文字带更高；宽度预算被 textPadX 挤窄，折行只会更多不会更少。
    expect(bigger.height).toBeGreaterThan(plain.height);
    expect(bigger.width).toBe(plain.width);
  });
});
