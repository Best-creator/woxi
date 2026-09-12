import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { createContentSnapshot, isContentBasedOnCurrentOutline, textBlocksOf } from "./content-version";
import { resolveContentModel } from "./model";
import type { ContentReviewer } from "./ports";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface ReviewContentCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
}

export interface ReviewContentDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  reviewer: ContentReviewer;
  workflow: ContentWorkflowRepository;
  defaultModel?: string;
}

export type ReviewContentResult =
  | { kind: "reviewed"; revision: ArticleRevision<ContentRevisionSnapshot>; review: ArticleReview<import("./ports").ContentReviewResult> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "stale_outline" }
  | { kind: "reviewer_error"; message: string };

export async function reviewContent(
  command: ReviewContentCommand,
  dependencies: ReviewContentDependencies
): Promise<ReviewContentResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  const blocks = textBlocksOf(article.blocks);
  if (!article.planning.confirmedOutlineRevisionId || article.outline.length === 0 || blocks.length === 0) {
    return { kind: "not_ready" };
  }
  if (!isContentBasedOnCurrentOutline(article)) return { kind: "stale_outline" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  let snapshot: ContentRevisionSnapshot;
  try {
    snapshot = createContentSnapshot({ ...article, blocks }, sourceContext);
  } catch {
    return { kind: "not_ready" };
  }

  const model = resolveContentModel(command.model, dependencies.defaultModel);
  const checkpoint = await dependencies.workflow.checkpointContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    snapshot
  });
  if (checkpoint.kind !== "checkpointed") return checkpoint;

  let result;
  try {
    result = await dependencies.reviewer.review({
      topic: article.topic,
      targetAudience: "对该知识点零基础的普通读者",
      styleProfile: snapshot.styleProfile,
      blocks: snapshot.textBlocks.map((block) => ({
        id: block.id,
        type: block.type,
        content: block.content,
        order: block.order
      })),
      outline: article.outline.map((section) => ({
        id: section.id,
        title: section.title,
        ...(section.goal ? { goal: section.goal } : {}),
        ...(section.recommendedWords ? { recommendedWords: section.recommendedWords } : {}),
        order: section.order
      })),
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
  } catch (error) {
    return { kind: "reviewer_error", message: error instanceof Error ? error.message : "正文审核失败" };
  }

  const review = await dependencies.workflow.saveContentReview({
    revisionId: checkpoint.revision.id,
    model,
    result
  });
  return { kind: "reviewed", revision: checkpoint.revision, review };
}
