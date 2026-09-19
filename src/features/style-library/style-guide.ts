import type { StyleProfile } from "./domain";

/**
 * 把风格画像拼装成配图规划用的「绘制风格」文本。
 * 这是风格库进入规划器提示词的唯一出口：结构化字段 → 一段稳定顺序的多行文本，
 * 规划模型把它当作整体画风约束织进每张配图的提示词。
 * 输出顺序保持稳定（便于测试与日志比对），色板后附简短说明提升模型利用率。
 */
export function styleToGuideText(profile: StyleProfile): string {
  return [
    `【画风】${profile.promptTemplate}`,
    `【主色板】${profile.palette.join(" ")}（按画面占比从大到小排序）`,
    `【线条】${profile.lineWork}`,
    `【角色造型】${profile.characterDesign}`,
    `【构图】${profile.composition}`,
    `【背景】${profile.background}`,
    `【文字排版】${profile.textRendering}`,
    `【风格概括】${profile.summary}`
  ].join("\n");
}

/** style: 字段里风格库条目的标记前缀；规划路由据此解析成完整风格文本。 */
export const LIBRARY_STYLE_PREFIX = "library:";

export function isLibraryStyleRef(value: string): boolean {
  return value.startsWith(LIBRARY_STYLE_PREFIX) && value.length > LIBRARY_STYLE_PREFIX.length;
}

export function libraryStyleId(value: string): string {
  return value.slice(LIBRARY_STYLE_PREFIX.length);
}
