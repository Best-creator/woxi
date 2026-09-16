import type { KnowledgeBrief } from "@/features/articles/domain";
import type { StyleProfile } from "./style-profile";

export const CONTENT_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "quote",
  "callout",
  "knowledge_card"
] as const;

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export interface GeneratedContentBlock {
  sectionKey: string;
  type: ContentBlockType;
  content: string;
  level?: 1 | 2 | 3;
}

export interface GeneratedContent {
  title: string;
  blocks: GeneratedContentBlock[];
}

export interface GenerateContentOutlineSection {
  id: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order: number;
}

export interface GenerateContentInput {
  topic: string;
  targetAudience: string;
  brief: KnowledgeBrief;
  outline: GenerateContentOutlineSection[];
  recommendedTotalWords: number;
  styleProfile: StyleProfile;
  /** 漫画脚本专用：全篇分镜数上限。其他风格不传，提示词里也不会出现分镜约束。 */
  panelLimit?: number;
  sourceContext?: string;
  model?: string;
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

export interface ContentGenerator {
  generate(input: GenerateContentInput): Promise<GeneratedContent>;
}

export interface ContentReviewer {
  review(input: ReviewContentInput): Promise<ContentReviewResult>;
}
