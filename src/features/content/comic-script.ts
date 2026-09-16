import type { LengthPreset } from "@/features/articles/domain";
import { SCIENCE_COMIC_SCRIPT_PRESET, type StylePreset } from "./style-profile";

/**
 * 漫画脚本按「分镜」成篇，分镜数直接决定每格能分到多少画幅。
 *
 * 分镜给少了讲不透，给多了每格只剩几十字、读起来很干，所以不交给模型自由发挥，
 * 而是按长度预设钉死上限：short 4、standard 6、deep 8 格。
 */
export const COMIC_PANEL_LIMITS: Record<LengthPreset, number> = {
  short: 4,
  standard: 6,
  deep: 8
};

/**
 * 每格文案预算（这是决定「读起来累不累」的那条线）。
 *
 * 漫画是「扫一眼就懂」的媒介：一格塞进两百字，读者会直接划走。
 * 所以每格只留 1-2 句、约 40-70 字，全篇文案合计 200-300 字——
 * 信息密度交给画面承担，文字只负责把这一格的结论钉住。
 */
export const COMIC_CAPTION_RANGE = { min: 40, max: 70 } as const;
export const COMIC_TOTAL_WORD_RANGE = { min: 200, max: 300 } as const;

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

/**
 * 每格文案的字数区间；非漫画风格返回 undefined。
 *
 * 与 comicPanelLimit 分开暴露：分镜数管「讲几格」，文案预算管「每格写多少」，
 * 两者都由漫画预设独占，其他风格不该被这两个概念影响。
 */
export function comicCaptionRange(preset: StylePreset): { min: number; max: number } | undefined {
  return isComicScriptPreset(preset) ? { ...COMIC_CAPTION_RANGE } : undefined;
}

/** 写进提示词的一句话描述，避免字数区间在提示词里被手抄成第二份真相。 */
export function describeComicCaptionBudget(): string {
  return `每个分镜只写 1-2 句、约 ${COMIC_CAPTION_RANGE.min}-${COMIC_CAPTION_RANGE.max} 字，全篇文案合计 ${COMIC_TOTAL_WORD_RANGE.min}-${COMIC_TOTAL_WORD_RANGE.max} 字`;
}
