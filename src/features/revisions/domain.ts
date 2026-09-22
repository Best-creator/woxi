import type {
  ContentBlock,
  KnowledgeBrief,
  LengthPreset,
  OutlineSection,
  StoryboardRoute
} from "@/features/articles/domain";
import type { ImageAspectRatio, SpeechLine } from "@/features/images/domain";
import type { StyleProfile } from "@/features/content/style-profile";

export type RevisionScope = "outline" | "content";

export type RevisionReason =
  | "generated"
  | "review_checkpoint"
  | "review_applied"
  | "confirmed"
  | "manual"
  | "restored";

/** 快照里的帧描述符：恢复旧版本时按它重建占位帧，prompt 即生图的完整输入。 */
export interface StoryboardFrameSnapshot {
  prompt: string;
  altText: string;
  aspectRatio?: ImageAspectRatio;
  /** 帧的台词/旁白（可选）：恢复版本时随帧一起还原，烘段图时渲染成橙条。 */
  speechLine?: SpeechLine | null;
}

/**
 * 快照里的分镜段：与设计计划同形，外加捕获时刻的帧资产 id。
 * 恢复版本时 frameAssetIds 全部存活 → 原样保留绑定（已生成的图不动）；
 * 缺失 → 按 frames 描述符重建占位帧，回第四步重新出图。
 */
export interface StoryboardSnapshotSegment {
  id: string;
  sectionKey: string;
  title: string;
  route: StoryboardRoute;
  /** 该段成稿文案所在的正文块 id（标题块 + 文案块）。 */
  copyBlockIds: string[];
  order: number;
  frames: StoryboardFrameSnapshot[];
  frameAssetIds?: string[];
}

export interface OutlineRevisionSnapshot {
  title: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  lengthPreset: LengthPreset;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
  /**
   * 全篇剧情推演（2026-09-22 起大纲生成器随纲要一并产出）。
   * 可选：旧版本快照没有该字段，恢复旧版时推演随快照走，缺失就按无推演处理。
   */
  storyline?: string;
}

/** 正文快照只保存非图片正文块；配图由图片资产独立管理，不参与正文内容哈希。 */
export interface ContentRevisionSnapshot {
  title: string;
  textBlocks: ContentBlock[];
  outlineRevisionId: string;
  styleProfile: StyleProfile;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
  /**
   * 正文分镜设计（与 textBlocks 同代的结构）。
   * 不参与内容哈希——分镜结构变化不算正文内容变化；恢复旧版本时随快照还原，
   * 帧资产存活则保留绑定，缺失则按 frames 描述符重建占位帧。
   */
  storyboardSegments?: StoryboardSnapshotSegment[];
}

export interface CreateRevisionInput<TSnapshot> {
  articleId: string;
  scope: RevisionScope;
  snapshot: TSnapshot;
  /** 覆盖参与去重哈希的内容；缺省时直接哈希整个 snapshot。 */
  hashInput?: unknown;
  model: string | null;
  reason: RevisionReason;
}

export interface ArticleRevision<TSnapshot> {
  id: string;
  articleId: string;
  scope: RevisionScope;
  version: number;
  contentHash: string;
  snapshot: TSnapshot;
  model: string | null;
  reason: RevisionReason;
  createdAt: string;
}

export interface ArticleReview<TResult> {
  id: string;
  revisionId: string;
  model: string;
  result: TResult;
  createdAt: string;
}
