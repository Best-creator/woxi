import type { KnowledgeBrief, StoryboardRoute } from "@/features/articles/domain";
import type { StyleProfile } from "./style-profile";

export const CONTENT_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "quote",
  "knowledge_card"
] as const;

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export interface GenerateContentOutlineSection {
  id: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order: number;
}

/** 分镜设计器的输入：写作侧信息齐全，设计侧自带视觉约束。 */
export interface GenerateContentInput {
  topic: string;
  targetAudience: string;
  brief: KnowledgeBrief;
  outline: GenerateContentOutlineSection[];
  recommendedTotalWords: number;
  styleProfile: StyleProfile;
  sourceContext?: string;
  /** 绘制风格；缺省时按提示词里的默认（日系动漫）设计分镜。 */
  drawingStyle?: string;
  /** 参考形象摘要；缺省时不强制统一主角。 */
  character?: StoryboardCharacterBrief;
  model?: string;
}

/** 参考形象摘要：注入设计提示词，让所有分镜帧共用同一主角。 */
export interface StoryboardCharacterBrief {
  name: string;
  persona: string;
  description: string;
}

/** 一格分镜帧：prompt 就是引导生图模型的完整提示词。 */
export interface StoryboardDesignFrame {
  prompt: string;
  altText: string;
}

/** 一个分镜段：呈现路由 + 成稿文案 + 该路由所需数量的分镜帧。 */
export interface StoryboardDesignSegment {
  /** 对应的大纲章节 id（追溯覆盖关系）。 */
  sectionKey: string;
  /** 段落小标题，进段图标题卡。 */
  title: string;
  route: StoryboardRoute;
  /** 成稿文案：最终烘进段图里的文字。 */
  copy: string;
  frames: StoryboardDesignFrame[];
}

export interface StoryboardDesign {
  title: string;
  segments: StoryboardDesignSegment[];
}

/**
 * 第三步「设计正文分镜」的生成器：一次产出全篇的分镜设计
 * （逐段 route + 成稿文案 + 完整生图 prompt 的分镜帧）。
 */
export interface StoryboardDesigner {
  design(input: GenerateContentInput): Promise<StoryboardDesign>;
}

export type ContentReviewStatus = "passed" | "needs_revision" | "blocked";
export type ContentReviewSeverity = "warning" | "blocking";

export interface ContentReviewIssue {
  blockIds: string[];
  severity: ContentReviewSeverity;
  message: string;
}

export interface ContentReviewResult {
  status: ContentReviewStatus;
  summary: string;
  clarity: number;
  beginnerFriendliness: number;
  coherence: number;
  engagement: number;
  outlineCoverage: number;
  sourceFidelity: number | null;
  styleMatch: number;
  issues: ContentReviewIssue[];
}

export interface ReviewableContentBlock {
  id: string;
  type: string;
  content: string;
  order: number;
}

export interface ReviewContentInput {
  topic: string;
  targetAudience?: string;
  styleProfile: StyleProfile;
  blocks: ReviewableContentBlock[];
  outline: GenerateContentOutlineSection[];
  sourceContext?: string;
  model?: string;
}

export interface ContentReviewer {
  review(input: ReviewContentInput): Promise<ContentReviewResult>;
}
