export type ImageAssetType =
  | "cover"
  | "storyboard"
  | "concept"
  | "process"
  | "comparison"
  | "knowledge_card";

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

export interface ImageAsset extends ImagePlanSuggestion {
  id: string;
  articleId: string;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
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

