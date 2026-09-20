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

/**
 * 单格分镜帧专用的画风文本。
 *
 * 为什么不能直接复用上面的整页版画像：画像的【构图】【文字排版】描述的是**整页条漫**的排版
 * （居中章节标题、橙色对话框、圆形旁白头像、时间轴、家族树……），而剧情漫画形态出的是
 * **单格**帧、文字由渲染器另行烘字。实测把整页版照抄给单格，模型会把标题气泡和标牌
 * 画进画面（与我们的台词条重复），还会把构图塞满模块。这里只保留纯粹的画格要素
 * （画风/线条/角色造型/背景/风格概括），构图换成单格口径并点名整页版式让位。
 */
export function styleToFrameGuideText(profile: StyleProfile): string {
  return [
    `【画风】${profile.promptTemplate}`,
    `【线条】${profile.lineWork}`,
    `【角色造型】${profile.characterDesign}`,
    `【背景】${profile.background}`,
    `【构图（单格）】这一格只是竖向长图里的一屏，不是整页：主体居中、大量留白，一屏只演一个梗；` +
      `角色 2-5 只 + 1 个关键道具即可，道具与食物用简笔处理、不要画写实细节；` +
      `画像里的「章节标题 / 对话框 / 旁白头像 / 时间轴 / 家族树」等整页排版模块不适用于这一格。`,
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
