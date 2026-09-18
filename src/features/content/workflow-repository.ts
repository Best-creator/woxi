import type { Article, ContentBlock } from "@/features/articles/domain";
import type {
  ArticleReview,
  ArticleRevision,
  ContentRevisionSnapshot,
  RevisionReason
} from "@/features/revisions/domain";
import type { ContentReviewResult } from "./ports";
import type { StyleProfile } from "./style-profile";

export type ContentWorkflowWriteResult =
  | { kind: "saved"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" };

export interface SaveGeneratedContentInput {
  articleId: string;
  expectedUpdatedAt: string;
  model: string | null;
  title: string;
  textBlocks: ContentBlock[];
  styleProfile: StyleProfile;
  sourceContextSnapshot: string;
  /**
   * 版本原因；缺省 "generated"。按审核意见修订分镜时传 "review_applied"，
   * 让版本历史能区分「全新生成」与「按意见修订」。
   */
  reason?: RevisionReason;
}

export interface ContentWorkflowRepository {
  saveGeneratedContent(input: SaveGeneratedContentInput): Promise<ContentWorkflowWriteResult>;
  checkpointContent(input: {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
    snapshot: ContentRevisionSnapshot;
  }): Promise<
    | { kind: "checkpointed"; revision: ArticleRevision<ContentRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "conflict" }
  >;
  saveContentReview(input: {
    revisionId: string;
    model: string;
    result: ContentReviewResult;
  }): Promise<ArticleReview<ContentReviewResult>>;
  findCurrentContentReview(input: {
    articleId: string;
    snapshot: ContentRevisionSnapshot;
  }): Promise<{
    revision: ArticleRevision<ContentRevisionSnapshot>;
    review: ArticleReview<ContentReviewResult>;
  } | null>;
  findCurrentContentRevision(input: {
    articleId: string;
    snapshot: ContentRevisionSnapshot;
  }): Promise<ArticleRevision<ContentRevisionSnapshot> | null>;
  approveContent(input: {
    articleId: string;
    expectedUpdatedAt: string;
    revisionId: string;
    /** 审核可选：缺省时按未审核直接确认，跳过审核记录校验。 */
    reviewId?: string;
    reviewStatus?: ContentReviewResult["status"];
  }): Promise<ContentWorkflowWriteResult>;
  saveManualContentVersion(input: {
    articleId: string;
    expectedUpdatedAt: string;
    model: string;
    snapshot: ContentRevisionSnapshot;
  }): Promise<
    | { kind: "saved"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "conflict" }
  >;
  restoreContent(input: {
    articleId: string;
    versionId: string;
    expectedUpdatedAt: string;
  }): Promise<
    | { kind: "restored"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
    | { kind: "not_found" }
    | { kind: "version_not_found" }
    | { kind: "conflict" }
  >;
  listContentVersions(articleId: string): Promise<ArticleRevision<ContentRevisionSnapshot>[]>;
  listContentReviews(articleId: string): Promise<ArticleReview<ContentReviewResult>[]>;
}

export const MANUAL_CONTENT_REASON: RevisionReason = "manual";
