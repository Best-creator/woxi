import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "./generate-outline";
import { resolveOutlineModel } from "./model";
import type { OutlineReviewer } from "./ports";
import type { OutlineWorkflowRepository } from "./workflow-repository";

export interface ReviewOutlineCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
}

export interface ReviewOutlineDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  reviewer: OutlineReviewer;
  workflow: OutlineWorkflowRepository;
  defaultModel?: string;
}

export type ReviewOutlineResult =
  | { kind: "reviewed"; revision: import("@/features/revisions/domain").ArticleRevision<import("@/features/revisions/domain").OutlineRevisionSnapshot>; review: import("@/features/revisions/domain").ArticleReview<import("./domain").OutlineReviewResult> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "no_outline" }
  | { kind: "reviewer_error"; message: string };

export async function reviewOutline(
  command: ReviewOutlineCommand,
  dependencies: ReviewOutlineDependencies
): Promise<ReviewOutlineResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!article.brief || article.outline.length === 0 || article.planning.recommendedTotalWords === null) {
    return { kind: "no_outline" };
  }
  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const model = resolveOutlineModel(command.model, dependencies.defaultModel);
  const checkpoint = await dependencies.workflow.checkpointOutline({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    title: article.title,
    brief: article.brief,
    outline: article.outline,
    lengthPreset: article.planning.lengthPreset,
    recommendedTotalWords: article.planning.recommendedTotalWords,
    sourceContextSnapshot: sourceContext
  });
  if (checkpoint.kind !== "checkpointed") return checkpoint;
  let result;
  try {
    result = await dependencies.reviewer.review({
      topic: article.topic,
      targetAudience: "对该知识点零基础的普通读者",
      lengthPreset: article.planning.lengthPreset,
      recommendedTotalWords: article.planning.recommendedTotalWords,
      brief: article.brief,
      outline: article.outline.map((section) => ({ ...section, key: section.id })),
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
  } catch (error) {
    return { kind: "reviewer_error", message: error instanceof Error ? error.message : "大纲审核失败" };
  }
  const review = await dependencies.workflow.saveOutlineReview({
    revisionId: checkpoint.revision.id,
    model,
    result
  });
  return { kind: "reviewed", revision: checkpoint.revision, review };
}
