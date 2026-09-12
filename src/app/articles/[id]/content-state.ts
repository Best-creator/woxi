import type { Article } from "@/features/articles/domain";
import { textBlocksOf } from "@/features/content/content-version";
import type { ContentReviewResult } from "@/features/content/ports";
import type { ContentWorkflowRepository } from "@/features/content/workflow-repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import type { SourceDocument } from "@/features/sources/domain";

export type ContentWorkspaceReview = {
  revision: ArticleRevision<ContentRevisionSnapshot>;
  review: ArticleReview<ContentReviewResult>;
} | null;

export type ContentVersionReviews = Record<string, ArticleReview<ContentReviewResult>>;

export function reviewsByContentVersion(
  versions: ArticleRevision<ContentRevisionSnapshot>[],
  reviews: ArticleReview<ContentReviewResult>[]
): ContentVersionReviews {
  const byRevisionId = new Map(reviews.map((review) => [review.revisionId, review]));
  const latestByHash = new Map<string, ArticleReview<ContentReviewResult>>();
  for (const version of versions) {
    const review = byRevisionId.get(version.id);
    if (!review) continue;
    const existing = latestByHash.get(version.contentHash);
    if (!existing || existing.createdAt < review.createdAt) {
      latestByHash.set(version.contentHash, review);
    }
  }
  const versionReviews: ContentVersionReviews = {};
  for (const version of versions) {
    const review = byRevisionId.get(version.id) ?? latestByHash.get(version.contentHash);
    if (review) versionReviews[version.id] = review;
  }
  return versionReviews;
}

export function reviewForContentVersion(
  version: ArticleRevision<ContentRevisionSnapshot> | null | undefined,
  versions: ArticleRevision<ContentRevisionSnapshot>[],
  versionReviews: ContentVersionReviews
): ArticleReview<ContentReviewResult> | null {
  if (!version) return null;
  if (versionReviews[version.id]) return versionReviews[version.id];
  const match = versions.find((item) => item.contentHash === version.contentHash && versionReviews[item.id]);
  return match ? versionReviews[match.id] : null;
}

/** 正文审核只对"当前草稿内容"有效；编辑正文、换风格或改资料都会让审核过期。 */
export function contentReviewIsStale(
  article: Article,
  sources: SourceDocument[],
  review: ContentWorkspaceReview
): boolean {
  if (!review) return false;
  const snapshot = review.revision.snapshot;
  return (
    snapshot.title !== article.title ||
    snapshot.outlineRevisionId !== article.planning.contentOutlineRevisionId ||
    snapshot.sourceContextSnapshot !== readySourceContext(sources) ||
    JSON.stringify(snapshot.textBlocks) !== JSON.stringify(textBlocksOf(article.blocks)) ||
    JSON.stringify(snapshot.styleProfile) !== JSON.stringify(article.styleProfile)
  );
}

export async function loadContentWorkspaceState(input: {
  article: Article;
  sources: SourceDocument[];
  workflow: Pick<
    ContentWorkflowRepository,
    "listContentVersions" | "listContentReviews" | "findCurrentContentReview"
  >;
}): Promise<{
  versions: ArticleRevision<ContentRevisionSnapshot>[];
  review: ContentWorkspaceReview;
  versionReviews: ContentVersionReviews;
}> {
  const [versions, reviews] = await Promise.all([
    input.workflow.listContentVersions(input.article.id),
    input.workflow.listContentReviews(input.article.id)
  ]);
  const versionReviews = reviewsByContentVersion(versions, reviews);
  const found = await input.workflow.findCurrentContentReview({
    articleId: input.article.id,
    snapshot: {
      title: input.article.title,
      textBlocks: textBlocksOf(input.article.blocks),
      outlineRevisionId: input.article.planning.contentOutlineRevisionId ?? "",
      styleProfile: input.article.styleProfile,
      recommendedTotalWords: input.article.planning.recommendedTotalWords ?? 0,
      sourceContextSnapshot: readySourceContext(input.sources)
    }
  });
  return { versions, review: found, versionReviews };
}
