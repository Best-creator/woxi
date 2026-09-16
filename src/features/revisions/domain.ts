import type {
  ContentBlock,
  KnowledgeBrief,
  LengthPreset,
  OutlineSection,
  StoryboardSegment
} from "@/features/articles/domain";
import type { StyleProfile } from "@/features/content/style-profile";

export type RevisionScope = "outline" | "content";

export type RevisionReason =
  | "generated"
  | "review_checkpoint"
  | "review_applied"
  | "confirmed"
  | "manual"
  | "restored";

export interface OutlineRevisionSnapshot {
  title: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  lengthPreset: LengthPreset;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
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
   * 不参与内容哈希——分镜结构变化不算正文内容变化；恢复旧版本时随快照还原。
   */
  storyboardSegments?: StoryboardSegment[];
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
