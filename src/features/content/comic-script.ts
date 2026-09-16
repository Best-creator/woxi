import type { LengthPreset } from "@/features/articles/domain";
import { SCIENCE_COMIC_SCRIPT_PRESET, type StylePreset } from "./style-profile";

/**
 * 漫画脚本按「分镜」成篇，分镜数直接决定每格能分到多少字。
 *
 * 分镜给少了讲不透，给多了每格只剩几十字、读起来很干——这是漫画叙事最容易踩的坑，
 * 所以不交给模型自由发挥，而是按长度预设钉死上限，保证每格至少约 200 字：
 * short 1200/4 = 300，standard 1500/6 = 250，deep 2000/8 = 250。
 */
export const COMIC_PANEL_LIMITS: Record<LengthPreset, number> = {
  short: 4,
  standard: 6,
  deep: 8
};

export function isComicScriptPreset(preset: StylePreset): boolean {
  return preset === SCIENCE_COMIC_SCRIPT_PRESET;
}

/**
 * 返回该风格下的分镜数上限；非漫画风格返回 undefined，表示不施加分镜约束。
 * 只有漫画脚本才该带这个值，避免其他预设被漫画的分镜概念污染。
 */
export function comicPanelLimit(preset: StylePreset, lengthPreset: LengthPreset): number | undefined {
  return isComicScriptPreset(preset) ? COMIC_PANEL_LIMITS[lengthPreset] : undefined;
}
