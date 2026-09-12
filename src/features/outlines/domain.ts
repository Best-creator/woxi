import type { KnowledgeBrief, LengthPreset } from "@/features/articles/domain";

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
  reviewFeedback?: OutlineReviewFeedback;
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
  sourceContext?: string;
  model?: string;
}
