import type { Article } from "@/features/articles/domain";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { OutlineReviewResult } from "@/features/outlines/domain";
import type { OutlineWorkflowRepository } from "@/features/outlines/workflow-repository";
import type { ArticleReview, ArticleRevision, OutlineRevisionSnapshot } from "@/features/revisions/domain";
import type { SourceDocument } from "@/features/sources/domain";

export type OutlineWorkspaceReview = {
  revision: ArticleRevision<OutlineRevisionSnapshot>;
  review: ArticleReview<OutlineReviewResult>;
} | null;

export type OutlineVersionReviews = Record<string, ArticleReview<OutlineReviewResult>>;

export function reviewsByOutlineVersion(
  versions: ArticleRevision<OutlineRevisionSnapshot>[],
  reviews: ArticleReview<OutlineReviewResult>[]
): OutlineVersionReviews {
  const byRevisionId = new Map(reviews.map((review) => [review.revisionId, review]));
  const latestByHash = new Map<string, ArticleReview<OutlineReviewResult>>();
  for (const version of versions) {
    const review = byRevisionId.get(version.id);
    if (!review) continue;
    const existing = latestByHash.get(version.contentHash);
    if (!existing || existing.createdAt < review.createdAt) {
      latestByHash.set(version.contentHash, review);
    }
  }
  const versionReviews: OutlineVersionReviews = {};
  for (const version of versions) {
    const review = byRevisionId.get(version.id) ?? latestByHash.get(version.contentHash);
    if (review) versionReviews[version.id] = review;
  }
  return versionReviews;
}

export function reviewForOutlineVersion(
  version: ArticleRevision<OutlineRevisionSnapshot> | null | undefined,
  versions: ArticleRevision<OutlineRevisionSnapshot>[],
  versionReviews: OutlineVersionReviews
): ArticleReview<OutlineReviewResult> | null {
  if (!version) return null;
  if (versionReviews[version.id]) return versionReviews[version.id];
  const match = versions.find((item) => item.contentHash === version.contentHash && versionReviews[item.id]);
  return match ? versionReviews[match.id] : null;
}

export async function loadOutlineWorkspaceState(input: {
  article: Article;
  sources: SourceDocument[];
  workflow: Pick<OutlineWorkflowRepository, "listOutlineVersions" | "listOutlineReviews" | "findCurrentOutlineReview">;
}): Promise<{
  versions: ArticleRevision<OutlineRevisionSnapshot>[];
  review: OutlineWorkspaceReview;
  versionReviews: OutlineVersionReviews;
}> {
  const [versions, reviews] = await Promise.all([
    input.workflow.listOutlineVersions(input.article.id),
    input.workflow.listOutlineReviews(input.article.id)
  ]);
  const versionReviews = reviewsByOutlineVersion(versions, reviews);
  if (!input.article.brief || input.article.outline.length === 0 || input.article.planning.recommendedTotalWords === null) {
    return { versions, review: null, versionReviews };
  }
  const review = await input.workflow.findCurrentOutlineReview({
    articleId: input.article.id,
    snapshot: {
      title: input.article.title,
      brief: input.article.brief,
      outline: input.article.outline,
      lengthPreset: input.article.planning.lengthPreset,
      recommendedTotalWords: input.article.planning.recommendedTotalWords,
      sourceContextSnapshot: readySourceContext(input.sources)
    }
  });
  return { versions, review, versionReviews };
}
