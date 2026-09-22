import type { StyleProfile } from "@/features/content/style-profile";

export type ArticleStatus =
  | "draft"
  | "brief_ready"
  | "outline_ready"
  | "editing"
  | "content_ready"
  | "ready_to_publish";

/**
 * 长度档位的**唯一事实源**：键的书写顺序就是界面上的档位顺序，值是该档允许的推荐总字数区间。
 * `LENGTH_PRESET_IDS`（下拉顺序）、`LENGTH_PRESET_LABELS`（显示名）、schema 的枚举与
 * 推荐字数上下限全部由它派生——加一档只改这里，漏登记会被类型和守卫测试同时挡下。
 *
 * `brief` 是给剧情漫画体量预留的一档，也是**新文章的默认档**（见 DEFAULT_ARTICLE_PLANNING）：
 * 漫画一段只演一个节拍、每段 ≤60 字，同样的字数在漫画形态下要多摊成三四个小段。
 * 区间收在 550-650 是用户拍板的体量：按「段数 ≈ 预算 ÷ 55」正好 **10-12 段**——
 * 「整体尽可能十段左右」，再宽模型就会在区间里自由取值，段数稳不住（2026-09-20 的教训）。
 */
export const LENGTH_RANGES = {
  brief: { min: 550, max: 650 },
  short: { min: 800, max: 1200 },
  standard: { min: 1000, max: 1500 },
  deep: { min: 1500, max: 2000 }
} as const;

export type LengthPreset = keyof typeof LENGTH_RANGES;

export const LENGTH_PRESET_IDS = [
  "brief",
  "short",
  "standard",
  "deep"
] as const satisfies readonly LengthPreset[];

export const LENGTH_PRESET_LABELS: Record<LengthPreset, string> = {
  brief: "轻量",
  short: "短篇",
  standard: "标准",
  deep: "深度"
};

/** 推荐总字数的合法区间：由各档区间推导，档位与 schema 不会再各写一份数。 */
export const MIN_RECOMMENDED_WORDS = Math.min(
  ...Object.values(LENGTH_RANGES).map((range) => range.min)
);
export const MAX_RECOMMENDED_WORDS = Math.max(
  ...Object.values(LENGTH_RANGES).map((range) => range.max)
);

export interface ArticlePlanning {
  lengthPreset: LengthPreset;
  recommendedTotalWords: number | null;
  confirmedOutlineRevisionId: string | null;
  contentOutlineRevisionId: string | null;
  /**
   * 漫画长图排法决策：视觉规划器规划分镜时一并给出（深结合），
   * 拼长图 auto 模式直接消费。存原始字符串，消费端用 isComicStripMode 校验，
   * 无效值自动回落到拼图阶段的规则路由。
   */
  comicStripMode?: string | null;
  comicStripReason?: string | null;
  /**
   * 正文分镜设计（第三步「设计正文分镜」的产物）。
   * 每个段落自带呈现路由（图+文 / 文+图 / 图+文+图）、成稿文案块与分镜帧资产；
   * 分段拼接（每段一张段图进公众号）按这里的路由消费。
   */
  storyboardSegments?: StoryboardSegment[] | null;
  /**
   * 分段拼接的字体选择（images 域 STORYBOARD_FONT_OPTIONS 里的 id）。
   * 文案烘进段图后字体就是像素，成稿观感由这里决定；空值/未知 id 在拼接时回落默认字体。
   */
  storyboardFontId?: string | null;
  /**
   * 分段拼接的文字大小档位（images 域 STORYBOARD_TEXT_SCALE_OPTIONS 里的 id）。
   * 段图在公众号里恒为 100% 宽显示，字号烘进图就是最终观感——手机上 1080 的画布
   * 缩到约 0.32 倍，所以「字够不够大」只能靠这里调。空值/未知 id 回落标准档。
   */
  storyboardTextScaleId?: string | null;
  /**
   * 呈现形态（story_comic=剧情漫画 / illustrated=讲解式）：第三步生成分镜时写入。
   * 原样透传，消费端一律走 resolveStoryboardPresentation 解析——未设置时按
   * 「是否已经设计过分镜」推断，旧文零迁移、新文默认剧情漫画。
   */
  presentation?: string | null;
  /**
   * 全篇剧情推演（大纲生成器产出的「故事线蓝图」）：一段 200-400 字的连续叙事——
   * 开场怎么进、情绪怎么铺、场景怎么切换、伏笔在哪里抛、末尾落位到哪。
   * 第三步设计器以它为最高约束逐段落笔，让段与段之间是一条被推演串起来的故事线，
   * 而不是一摞各自为政的知识卡。旧文为 null：消费端按「缺失就不约束」处理，零迁移。
   */
  storyline?: string | null;
}

/**
 * 分镜段的段内呈现路由：决定该段「分镜帧 + 成稿文案」的拼图排法。
 * 前三种取值与漫画长图 ComicStripMode 一致，分段拼接复用同一套拼接引擎；
 * text_only（纯文字）是第四种：0 帧、不拼段图，文案以普通正文块直接发布。
 */
export type StoryboardRoute = "image_text" | "text_image" | "image_text_image" | "text_only";

export const STORYBOARD_ROUTES: readonly StoryboardRoute[] = [
  "image_text",
  "text_image",
  "image_text_image",
  "text_only"
];

export const STORYBOARD_ROUTE_LABELS: Record<StoryboardRoute, string> = {
  image_text: "图 + 文",
  text_image: "文 + 图",
  image_text_image: "图 + 文 + 图",
  text_only: "纯文字"
};

export function isStoryboardRoute(value: unknown): value is StoryboardRoute {
  return typeof value === "string" && (STORYBOARD_ROUTES as readonly string[]).includes(value);
}

/**
 * 路由需要的分镜帧数：图+文 / 文+图 各 1 帧，图+文+图 2 帧，纯文字 0 帧。
 * 0 帧时该段不产生任何分镜资产，拼接阶段整段跳过。
 */
export function storyboardFrameCount(route: StoryboardRoute): 0 | 1 | 2 {
  if (route === "image_text_image") return 2;
  return route === "text_only" ? 0 : 1;
}

/**
 * 呈现形态：第三步「设计正文分镜」的两套编排。
 * - illustrated（讲解式）：知识写进文案块、画面当配图，每块 30-60 字（旧行为）；
 * - story_comic（剧情漫画）：一段一个梗、群体拟人化演出，文字只做旁白式点睛（每段 ≤60 字）。
 * 形态只改「怎么编排」，不改呈现路由与渲染引擎：两种形态共用同一套 route 与段图拼接。
 */
export type StoryboardPresentation = "illustrated" | "story_comic";

export const STORYBOARD_PRESENTATIONS: readonly StoryboardPresentation[] = [
  "illustrated",
  "story_comic"
];

export const STORYBOARD_PRESENTATION_LABELS: Record<StoryboardPresentation, string> = {
  illustrated: "讲解式",
  story_comic: "剧情漫画"
};

export function isStoryboardPresentation(value: unknown): value is StoryboardPresentation {
  return (
    typeof value === "string" && (STORYBOARD_PRESENTATIONS as readonly string[]).includes(value)
  );
}

/**
 * 解析文章的呈现形态。未设置或取值非法时按「新旧」推断，避免做数据迁移：
 * 已经设计过分镜的（有 segments）视为旧文 → illustrated，产物一个字不变；
 * 还没设计过的新文 → story_comic（新形态默认）。
 */
export function resolveStoryboardPresentation(
  planning: Pick<ArticlePlanning, "presentation" | "storyboardSegments">
): StoryboardPresentation {
  if (isStoryboardPresentation(planning.presentation)) return planning.presentation;
  return planning.storyboardSegments?.length ? "illustrated" : "story_comic";
}

/**
 * 一个正文分镜段。成稿文案的内容以 `copyBlockIds` 指向的正文块为准
 * （文案只存一份，编辑走正文块），段本身只记结构与帧引用。
 */
export interface StoryboardSegment {
  id: string;
  /** 对应的大纲章节 id：追溯这段覆盖了大纲的哪部分。 */
  sectionKey: string;
  /** 段落小标题，设计视图与段图标题卡使用。 */
  title: string;
  route: StoryboardRoute;
  /** 该段成稿文案所在的正文块 id（标题块 + 文案块），按顺序烘进段图。 */
  copyBlockIds: string[];
  /** 分镜帧资产 id（image_assets, type=storyboard），顺序即拼图顺序。 */
  frameAssetIds: string[];
  order: number;
}

export const DEFAULT_ARTICLE_PLANNING: ArticlePlanning = {
  // 默认轻量档：剧情漫画一段一个节拍，550-650 字正好摊成 10-12 段（「十段左右」的体量）。
  // 旧默认 standard 会让漫画长到 17-22 段，作者每次都要手动往回调。
  lengthPreset: "brief",
  recommendedTotalWords: null,
  confirmedOutlineRevisionId: null,
  contentOutlineRevisionId: null
};

export type BlockType =
  | "heading"
  | "paragraph"
  | "quote"
  | "callout"
  | "knowledge_card"
  | "image";

export interface ContentBlock {
  id: string;
  type: BlockType;
  content: string;
  order: number;
  level?: 1 | 2 | 3;
  altText?: string;
  assetId?: string;
  /** 正文分镜段标记：该块属于哪个 StoryboardSegment（成稿文案块携带）。 */
  segmentId?: string;
  version: number;
}

export interface OutlineSection {
  id: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order: number;
}

export interface KnowledgeBrief {
  oneSentence: string;
  concepts: string[];
  prerequisites: string[];
  misconceptions: string[];
  analogies: string[];
  unsupportedNotes: string[];
}

export interface Article {
  id: string;
  title: string;
  topic: string;
  status: ArticleStatus;
  brief: KnowledgeBrief | null;
  outline: OutlineSection[];
  blocks: ContentBlock[];
  planning: ArticlePlanning;
  styleProfile: StyleProfile;
  outlineConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
