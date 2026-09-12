import type {
  Article,
  KnowledgeBrief,
  LengthPreset,
  OutlineSection
} from "@/features/articles/domain";
import type {
  ArticleReview,
  ArticleRevision,
  OutlineRevisionSnapshot,
  RevisionReason
} from "@/features/revisions/domain";
import type { OutlineReviewResult } from "./domain";

export type OutlineWorkflowWriteResult =
  | { kind: "saved"; article: Article; revision: ArticleRevision<OutlineRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" };

export interface OutlineSnapshotInput {
  title: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  lengthPreset: LengthPreset;
  recommendedTotalWords: number;
  sourceContextSnapshot: string;
}

export interface OutlineWorkflowRepository {
  saveGeneratedOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
    reason?: Extract<RevisionReason, "generated" | "review_applied">;
  }): Promise<OutlineWorkflowWriteResult>;
  checkpointOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
  }): Promise<
    | { kind: "checkpointed"; revision: ArticleRevision<OutlineRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "conflict" }
  >;
  saveOutlineReview(input: {
    revisionId: string;
    model: string;
    result: OutlineReviewResult;
  }): Promise<ArticleReview<OutlineReviewResult>>;
  findCurrentOutlineReview(input: {
    articleId: string;
    snapshot: OutlineRevisionSnapshot;
  }): Promise<{
    revision: ArticleRevision<OutlineRevisionSnapshot>;
    review: ArticleReview<OutlineReviewResult>;
  } | null>;
  confirmOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    revisionId: string;
    reviewId: string;
    reviewStatus: OutlineReviewResult["status"];
  }): Promise<OutlineWorkflowWriteResult>;
  saveManualOutlineVersion(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string;
  }): Promise<
    | { kind: "saved"; article: Article; revision: ArticleRevision<OutlineRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "conflict" }
  >;
  restoreOutline(input: {
    articleId: string;
    versionId: string;
    expectedUpdatedAt: string;
  }): Promise<
    | { kind: "restored"; article: Article; revision: ArticleRevision<OutlineRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "version_not_found" }
    | { kind: "conflict" }
  >;
  listOutlineVersions(articleId: string): Promise<ArticleRevision<OutlineRevisionSnapshot>[]>;
  listOutlineReviews(articleId: string): Promise<ArticleReview<OutlineReviewResult>[]>;
}

export function toOutlineRevisionSnapshot(input: OutlineSnapshotInput): OutlineRevisionSnapshot {
  return {
    title: input.title,
    brief: input.brief,
    outline: input.outline,
    lengthPreset: input.lengthPreset,
    recommendedTotalWords: input.recommendedTotalWords,
    sourceContextSnapshot: input.sourceContextSnapshot
  };
}

export const MANUAL_OUTLINE_REASON: RevisionReason = "manual";
