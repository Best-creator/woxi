import type { ContentBlock } from "@/features/articles/domain";

export type ImageAssetType =
  | "cover"
  | "storyboard"
  | "concept"
  | "process"
  | "comparison"
  | "knowledge_card"
  | "comic_strip";

/**
 * 长图把「分镜图 + 中间的文字」拼成一张图的三种排法。
 *
 * - image_text：一格图，下面跟这一格的文案
 * - text_image：文案在上、图在下，先铺垫再给画面
 * - image_text_image：两图夹一文——分镜两两成组，文案落在两张图正中间，最像连环画
 */
export type ComicStripMode = "image_text" | "text_image" | "image_text_image";

export const COMIC_STRIP_MODES: readonly ComicStripMode[] = [
  "image_text",
  "text_image",
  "image_text_image"
];

export const COMIC_STRIP_MODE_LABELS: Record<ComicStripMode, string> = {
  image_text: "图 + 文",
  text_image: "文 + 图",
  image_text_image: "图 + 文 + 图"
};

export function isComicStripMode(value: unknown): value is ComicStripMode {
  return typeof value === "string" && (COMIC_STRIP_MODES as readonly string[]).includes(value);
}

export type ImageAssetStatus =
  | "planned"
  | "placeholder"
  | "generating"
  | "generated"
  | "disabled"
  | "failed";

export type ImageAspectRatio = "cover" | "landscape" | "square" | "portrait";

export interface ImagePlanSuggestion {
  type: ImageAssetType;
  anchorBlockId: string | null;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImageAspectRatio;
}

/**
 * 漫画长图替换掉的正文。
 *
 * 存的是**内容快照**而不是块 id：正文合并后会把图块重新插回 blocks_json，
 * 被替换的块一旦从那里消失就再也找不回来。带着原文走，取消长图时才能原样放回去。
 */
export interface ConsumedContent {
  blocks: ContentBlock[];
  /** 放回正文时插在这一块之前；null 表示追加到正文末尾。 */
  resumeBeforeBlockId: string | null;
}

export interface ImageAsset extends ImagePlanSuggestion {
  id: string;
  articleId: string;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
  /** 普通配图是 null；漫画长图带一份被它替换掉的正文快照，用于随时撤销。 */
  consumedContent: ConsumedContent | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 一次真实生图的产物。
 *
 * 同一张配图可以保留多版：重生成不再覆盖上一张，而是新增一条记录，
 * 由作者在界面上选用。`ImageAsset.filePath/publicUrl` 始终镜像「当前选中的那一版」，
 * 所以正文块、content 路由、公众号发布这些下游消费者都不需要知道版本的存在。
 *
 * `selected` 只是这套镜像关系的冗余标记，方便界面直接标出「正在使用」。
 * 同一 assetId 下最多一条 selected = 1（由仓储在事务里保证）。
 */
export interface ImageGeneration {
  id: string;
  articleId: string;
  assetId: string;
  /** 生成时用的提示词快照：提示词事后被改过也能看出这一版是怎么来的。 */
  prompt: string;
  model: string | null;
  filePath: string | null;
  publicUrl: string | null;
  selected: boolean;
  createdAt: string;
}

/** 配图版本条/素材库条目在界面上的统一形态：带出处信息，便于跨槽位复用。 */
export interface ImageLibraryItem extends ImageGeneration {
  assetType: ImageAssetType;
  assetPurpose: string;
}

