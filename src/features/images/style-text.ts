import type { StyleLibraryRepository } from "@/features/style-library/domain";
import {
  isLibraryStyleRef,
  libraryStyleId,
  styleToFrameGuideText,
  styleToGuideText
} from "@/features/style-library/style-guide";

/**
 * 把「配图偏好里的 style 字段」解析成完整的绘制风格文本。
 *
 * - 风格库条目（`library:<id>`）→ 展开成风格画像文本（`options.frame` 时用单格帧裁剪版，
 *   见 `styleToFrameGuideText`）；自由文本 → 原样返回（作者手写的一句话画风）；
 * - 空值、或者指向已被删除的条目 → null（调用方按「没有画风」处理）。
 *
 * 单独成模块是因为它有两个消费者：**生成阶段**（前置进生图提示词）与
 * **设计阶段**（第三步设计分镜时告诉模型画风是什么，避免它自己写一套画风词，
 * 到生图时和前置的画风引导互相打架）。
 */
export async function resolveStyleText(
  style: string | null | undefined,
  styleLibrary?: StyleLibraryRepository | null,
  options: { frame?: boolean } = {}
): Promise<string | null> {
  const value = style?.trim();
  if (!value) return null;
  if (!isLibraryStyleRef(value)) return value;
  if (!styleLibrary) return null;
  const entry = await styleLibrary.findById(libraryStyleId(value));
  if (!entry) return null;
  return options.frame ? styleToFrameGuideText(entry.profile) : styleToGuideText(entry.profile);
}

/**
 * 未指定画风时的全站默认口径（2026-09-20 拍板：黑白线条纸质漫画，替代旧默认「日系动漫赛璐璐」）。
 * 消费方：设计阶段提示词（讲解式/剧情漫画，未给 drawingStyle 时写进每格 prompt）、
 * 视觉规划提示词、参考形象图、Demo 设计器/规划器。改默认画风只改这一处。
 */
export const DEFAULT_DRAWING_STYLE =
  "黑白线条漫画风：纯黑白不上色，手绘钢笔线条，阴影用排线与网点，纸质漫画质感，可用速度线与情绪符号";
