import type { StyleLibraryRepository, StyleProfile } from "./domain";

/**
 * 内置画风画像：不依赖 style-lab 提炼、开箱即用的官方风格。
 * 与导入风格同表同构，upsert 以 name 为冲突键——幂等，重复 ensure 不会产生重复条目。
 *
 * 「简约主体·白底动作戏」是「连贯叙事·小说感」文风预设（style-profile 的
 * novel_narrator）的配套画风：文字侧管钩子链，画面侧管主体动作与极简背景，
 * 两者的审美是同一件事——去掉一切与主线无关的东西。
 * 联动逻辑在 segment-frames-panel（作者没手选过画风时默认选中它），风格名改动要两处同步。
 */
export const BUILT_IN_MINIMAL_ACTION_STYLE_NAME = "简约主体·白底动作戏";

const MINIMAL_ACTION_STYLE: StyleProfile = {
  name: BUILT_IN_MINIMAL_ACTION_STYLE_NAME,
  summary:
    "纯白底极简动作漫画：角色连续动作占画面主体，背景留白只留一个道具暗示，角色造型全篇锁定一眼认得出。",
  palette: ["#FFFFFF", "#1A1A1A", "#F28C28"],
  lineWork: "干净利落的粗描边，无杂线无阴影堆叠；细节只花在动作与表情上，其余一律从简。",
  characterDesign:
    "同一物种的拟人化角色，造型全篇锁定：同款脸型、同款服装配色、同一处标志特征（如围裙、帽子、腮红），每张图认得出是同一批。",
  composition:
    "主体动作居中占画面六成以上，近景与特写优先；一屏只演一个动作，禁止把群像和道具塞满画面。",
  background:
    "纯白留白（#FFFFFF）：不画房间、店铺、街道等完整环境，不铺纸纹不加渐变；至多一个纯色色块、一条地平线或一个道具剪影暗示地点。",
  textRendering:
    "画面内不出现任何文字：无标题、无气泡字、无招牌字、无告示牌字，台词与排版由系统另行完成。",
  promptTemplate:
    "极简白底动作漫画：主体角色的连续动作演出占据画面主体，纯白背景大面积留白，" +
    "背景至多一个纯色色块或一个道具剪影暗示地点，角色造型与参考形象完全一致，画面内不出现任何文字。"
};

/** 目前只有一个内置风格；后续新增往数组里追加即可（ensure 幂等）。 */
const BUILT_IN_STYLES: ReadonlyArray<{ profile: StyleProfile; source: string }> = [
  { profile: MINIMAL_ACTION_STYLE, source: "内置风格（连贯叙事配套）" }
];

/**
 * 按仓储实例记忆「已 ensure」：生产环境 getStyleLibraryRepository 是单例，
 * 等价于进程内只跑一次；测试里每个内存仓储都是新对象，天然互不污染。
 */
const ensuredRepositories = new WeakSet<StyleLibraryRepository>();

/**
 * 确保内置画风已入库（幂等：按 name upsert）。每个仓储实例只跑一次，
 * 由风格库列表路由在返回前调用——第四步画风下拉与联动都吃这个列表，
 * 保证「简约主体」在任何环境（新库/旧库/E2E 库）都存在可选。
 * upsert 失败（表锁、只读库）不抛出：画风缺失只是退化为无联动，不该挂掉列表接口。
 */
export async function ensureBuiltInStyles(repository: StyleLibraryRepository): Promise<void> {
  if (ensuredRepositories.has(repository)) return;
  ensuredRepositories.add(repository);
  for (const builtIn of BUILT_IN_STYLES) {
    try {
      await repository.upsert(builtIn.profile, builtIn.source);
    } catch {
      // 静默：下一轮进程重启会再试。
    }
  }
}
