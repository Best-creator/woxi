import { describe, expect, it } from "vitest";
import {
  COMIC_CAPTION_RANGE,
  COMIC_PANEL_LIMITS,
  COMIC_TOTAL_WORD_RANGE,
  comicCaptionRange,
  comicPanelLimit,
  describeComicCaptionBudget,
  isComicScriptPreset
} from "./comic-script";
import { STYLE_PRESET_LABELS, type StylePreset } from "./style-profile";

const NON_COMIC_PRESETS: StylePreset[] = [
  "popular_science_teacher",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "knowledge_cards",
  "custom"
];

describe("comic panel limits", () => {
  it("caps panels per length preset so every panel keeps enough room", () => {
    expect(COMIC_PANEL_LIMITS).toEqual({ short: 4, standard: 6, deep: 8 });
  });

  it("only applies the cap to the comic script preset", () => {
    expect(isComicScriptPreset("science_comic_script")).toBe(true);
    expect(comicPanelLimit("science_comic_script", "standard")).toBe(6);

    for (const preset of NON_COMIC_PRESETS) {
      expect(isComicScriptPreset(preset)).toBe(false);
      expect(comicPanelLimit(preset, "standard")).toBeUndefined();
    }
  });

  it("grows with the length preset", () => {
    const limits = (["short", "standard", "deep"] as const).map((preset) =>
      comicPanelLimit("science_comic_script", preset)
    );

    expect(limits).toEqual([...limits].sort((left, right) => (left as number) - (right as number)));
    expect(new Set(limits).size).toBe(limits.length);
  });

  it("keeps the comic preset listed in the style labels", () => {
    expect(STYLE_PRESET_LABELS.science_comic_script).toBe("科普漫画脚本");
  });
});

describe("comic caption budget", () => {
  it("caps a panel at a couple of sentences so a panel never becomes a wall of text", () => {
    expect(COMIC_CAPTION_RANGE).toEqual({ min: 40, max: 70 });
    expect(COMIC_TOTAL_WORD_RANGE).toEqual({ min: 200, max: 300 });
  });

  it("only applies the caption budget to the comic script preset", () => {
    expect(comicCaptionRange("science_comic_script")).toEqual({ min: 40, max: 70 });

    for (const preset of NON_COMIC_PRESETS) {
      expect(comicCaptionRange(preset)).toBeUndefined();
    }
  });

  it("keeps the whole piece within the per-panel budget it advertises", () => {
    // 全篇字数上限必须容得下最长长度预设的分镜数，否则提示词自相矛盾：
    // 一边要求写满 8 格，一边给的字数连 5 格都装不下。
    expect(COMIC_TOTAL_WORD_RANGE.max).toBeGreaterThanOrEqual(
      COMIC_CAPTION_RANGE.max * COMIC_PANEL_LIMITS.short
    );
    expect(COMIC_TOTAL_WORD_RANGE.min).toBeLessThanOrEqual(
      COMIC_CAPTION_RANGE.min * COMIC_PANEL_LIMITS.standard
    );
  });

  it("spells the numbers into the prompt description from one source of truth", () => {
    const described = describeComicCaptionBudget();

    expect(described).toContain(String(COMIC_CAPTION_RANGE.min));
    expect(described).toContain(String(COMIC_CAPTION_RANGE.max));
    expect(described).toContain(String(COMIC_TOTAL_WORD_RANGE.min));
    expect(described).toContain(String(COMIC_TOTAL_WORD_RANGE.max));
  });
});
