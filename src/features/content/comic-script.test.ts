import { describe, expect, it } from "vitest";
import { COMIC_PANEL_LIMITS, comicPanelLimit, isComicScriptPreset } from "./comic-script";
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
