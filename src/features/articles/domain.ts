import type { StyleProfile } from "@/features/content/style-profile";

export type ArticleStatus =
  | "draft"
  | "brief_ready"
  | "outline_ready"
  | "editing"
  | "content_ready"
  | "ready_to_publish";

export type LengthPreset = "short" | "standard" | "deep";

export const LENGTH_RANGES = {
  short: { min: 800, max: 1200 },
  standard: { min: 1000, max: 1500 },
  deep: { min: 1500, max: 2000 }
} as const;

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
}

/**
 * 分镜段的段内呈现路由：决定该段「分镜帧 + 成稿文案」的拼图排法。
 * 取值与漫画长图 ComicStripMode 一致，分段拼接复用同一套拼接引擎。
 */
export type StoryboardRoute = "image_text" | "text_image" | "image_text_image";

export const STORYBOARD_ROUTES: readonly StoryboardRoute[] = [
  "image_text",
  "text_image",
  "image_text_image"
];

export const STORYBOARD_ROUTE_LABELS: Record<StoryboardRoute, string> = {
  image_text: "图 + 文",
  text_image: "文 + 图",
  image_text_image: "图 + 文 + 图"
};

export function isStoryboardRoute(value: unknown): value is StoryboardRoute {
  return typeof value === "string" && (STORYBOARD_ROUTES as readonly string[]).includes(value);
}

/** 路由需要的分镜帧数：图+文 / 文+图 各 1 帧，图+文+图 2 帧。 */
export function storyboardFrameCount(route: StoryboardRoute): 1 | 2 {
  return route === "image_text_image" ? 2 : 1;
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
  lengthPreset: "standard",
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
