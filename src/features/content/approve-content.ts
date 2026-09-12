import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { Article } from "@/features/articles/domain";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { createContentSnapshot, isContentBasedOnCurrentOutline } from "./content-version";
import type { ContentReviewResult } from "./ports";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface ApproveContentCommand {
  articleId: string;
  expectedUpdatedAt: string;
  acknowledgeWarnings: boolean;
}

export interface ApproveContentDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  workflow: ContentWorkflowRepository;
}

export type ApproveContentResult =
  | {
      kind: "approved";
      article: Article;
      revision: ArticleRevision<ContentRevisionSnapshot>;
      review: ArticleReview<ContentReviewResult>;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "stale_outline" }
  | { kind: "review_required" }
  | { kind: "blocked" }
  | { kind: "acknowledgement_required" };

export async function approveContent(
  command: ApproveContentCommand,
  dependencies: ApproveContentDependencies
): Promise<ApproveContentResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!article.planning.confirmedOutlineRevisionId || article.outline.length === 0) {
    return { kind: "not_ready" };
  }
  if (!isContentBasedOnCurrentOutline(article)) return { kind: "stale_outline" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  let snapshot: ContentRevisionSnapshot;
  try {
    snapshot = createContentSnapshot(article, sourceContext);
  } catch {
    return { kind: "not_ready" };
  }

  const current = await dependencies.workflow.findCurrentContentReview({ articleId: article.id, snapshot });
  if (!current) return { kind: "review_required" };
  if (current.review.result.status === "blocked") return { kind: "blocked" };
  if (current.review.result.status === "needs_revision" && !command.acknowledgeWarnings) {
    return { kind: "acknowledgement_required" };
  }

  const saved = await dependencies.workflow.approveContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    revisionId: current.revision.id,
    reviewId: current.review.id,
    reviewStatus: current.review.result.status
  });
  return saved.kind === "saved"
    ? { kind: "approved", article: saved.article, revision: saved.revision, review: current.review }
    : saved;
}
