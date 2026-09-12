import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "./generate-outline";
import type { OutlineWorkflowRepository } from "./workflow-repository";

export interface ConfirmOutlineCommand {
  articleId: string;
  expectedUpdatedAt: string;
  acknowledgeWarnings: boolean;
}

export interface ConfirmOutlineDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  workflow: OutlineWorkflowRepository;
}

export type ConfirmOutlineResult =
  | { kind: "confirmed"; article: import("@/features/articles/domain").Article; revision: import("@/features/revisions/domain").ArticleRevision<import("@/features/revisions/domain").OutlineRevisionSnapshot>; review: import("@/features/revisions/domain").ArticleReview<import("./domain").OutlineReviewResult> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "no_outline" }
  | { kind: "review_required" }
  | { kind: "blocked" }
  | { kind: "acknowledgement_required" };

export async function confirmOutline(
  command: ConfirmOutlineCommand,
  dependencies: ConfirmOutlineDependencies
): Promise<ConfirmOutlineResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!article.brief || article.outline.length === 0 || article.planning.recommendedTotalWords === null) {
    return { kind: "no_outline" };
  }
  const sourceContextSnapshot = readySourceContext(await dependencies.sources.list(article.id));
  const snapshot = {
    title: article.title,
    brief: article.brief,
    outline: article.outline,
    lengthPreset: article.planning.lengthPreset,
    recommendedTotalWords: article.planning.recommendedTotalWords,
    sourceContextSnapshot
  };
  const current = await dependencies.workflow.findCurrentOutlineReview({ articleId: article.id, snapshot });
  if (!current) return { kind: "review_required" };
  if (current.review.result.status === "blocked") return { kind: "blocked" };
  if (current.review.result.status === "needs_revision" && !command.acknowledgeWarnings) {
    return { kind: "acknowledgement_required" };
  }
  const saved = await dependencies.workflow.confirmOutline({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    revisionId: current.revision.id,
    reviewId: current.review.id,
    reviewStatus: current.review.result.status,
    ...snapshot
  });
  return saved.kind === "saved"
    ? { kind: "confirmed", article: saved.article, revision: saved.revision, review: current.review }
    : saved;
}
