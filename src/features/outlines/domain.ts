import type { KnowledgeBrief, LengthPreset } from "@/features/articles/domain";

/** 用户自述修改要求的长度上限；接口校验、输入框 maxLength、领域命令共用同一个值。 */
export const MAX_USER_INSTRUCTIONS_LENGTH = 1_000;

export interface OutlineWordRange {
  min: number;
  max: number;
}

export interface GeneratedOutlineSection {
  key: string;
  title: string;
  goal: string;
  recommendedWords: number;
}

export interface GeneratedOutline {
  workingTitle: string;
  recommendedTotalWords: number;
  brief: KnowledgeBrief;
  outline: GeneratedOutlineSection[];
  /**
   * 全篇剧情推演（故事线蓝图）：200-400 字的连续叙事，讲清楚开场怎么进、
   * 情绪怎么铺、场景怎么切换、伏笔在哪里抛、末尾落位到哪。
   * 它是大纲章节之间的「缝合层」——章节只是推演切出来的节拍。
   */
  storyline: string;
}

export interface OutlineReviewFeedback {
  status: OutlineReviewStatus;
  summary: string;
  issues: OutlineReviewIssue[];
  hiddenPrerequisites?: string[];
  complexDependencies?: string[];
}

export interface GenerateOutlineInput {
  topic: string;
  targetAudience: string;
  lengthPreset: LengthPreset;
  wordRange: OutlineWordRange;
  sourceContext?: string;
  currentBrief?: KnowledgeBrief;
  currentOutline?: GeneratedOutlineSection[];
  /** 修订时的现役剧情推演：模型必须在它基础上更新，而不是另起一条无关故事线。 */
  currentStoryline?: string;
  reviewFeedback?: OutlineReviewFeedback;
  /**
   * 作者本人用自然语言提的修改要求。
   * 与 reviewFeedback 来源不同（一个是审核模型的发现，一个是人的意图），可以同时出现；
   * 两者冲突时以 userInstructions 为准。
   */
  userInstructions?: string;
  model?: string;
}

export type OutlineReviewStatus = "passed" | "needs_revision" | "blocked";
export type OutlineReviewSeverity = "warning" | "blocking";

export interface OutlineReviewIssue {
  sectionKey: string;
  severity: OutlineReviewSeverity;
  message: string;
}

export interface OutlineReviewResult {
  status: OutlineReviewStatus;
  summary: string;
  coverage: number;
  granularity: number;
  beginnerFriendliness: number;
  logicalOrder: number;
  sourceSupport: number | null;
  hiddenPrerequisites: string[];
  complexDependencies: string[];
  issues: OutlineReviewIssue[];
}

export interface ReviewableOutlineSection {
  id?: string;
  key?: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order?: number;
}

export interface ReviewOutlineInput {
  topic: string;
  targetAudience?: string;
  lengthPreset?: LengthPreset;
  recommendedTotalWords?: number;
  brief?: KnowledgeBrief;
  outline: ReviewableOutlineSection[];
  /** 全篇剧情推演；给了它审核就要连带判故事线质量（连贯、转场有承载、伏笔有回收）。 */
  storyline?: string;
  sourceContext?: string;
  model?: string;
}
