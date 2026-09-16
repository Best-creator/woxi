import { randomUUID } from "node:crypto";
import { LENGTH_RANGES, type OutlineSection } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import { describeAudience } from "@/features/content/audience";
import type { SourceRepository } from "@/features/sources/repository";
import type { OutlineReviewFeedback } from "./domain";
import { readySourceContext } from "./generate-outline";
import { resolveOutlineModel } from "./model";
import type { OutlineGenerator } from "./ports";
import type { OutlineWorkflowRepository } from "./workflow-repository";

export interface ApplyOutlineReviewCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
  /** 作者自己提的修改要求；给了它就不再要求先有审核记录。 */
  userInstructions?: string;
}

export interface ApplyOutlineReviewDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  generator: OutlineGenerator;
  workflow: OutlineWorkflowRepository;
  defaultModel?: string;
}

export type ApplyOutlineReviewResult =
  | { kind: "revised"; article: import("@/features/articles/domain").Article; revision: import("@/features/revisions/domain").ArticleRevision<import("@/features/revisions/domain").OutlineRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "no_outline" }
  | { kind: "review_required" }
  | { kind: "no_revision_needed" }
  | { kind: "generator_error"; message: string };

export async function applyOutlineReview(
  command: ApplyOutlineReviewCommand,
  dependencies: ApplyOutlineReviewDependencies
): Promise<ApplyOutlineReviewResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!article.brief || article.outline.length === 0 || article.planning.recommendedTotalWords === null) {
    return { kind: "no_outline" };
  }
  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const current = await dependencies.workflow.findCurrentOutlineReview({
    articleId: article.id,
    snapshot: {
      title: article.title,
      brief: article.brief,
      outline: article.outline,
      lengthPreset: article.planning.lengthPreset,
      recommendedTotalWords: article.planning.recommendedTotalWords,
      sourceContextSnapshot: sourceContext
    }
  });

  // 有用户自述要求时不再拿审核状态当闸门：审核通过、甚至还没审核，作者都可以提要求改大纲。
  // 审核意见仍然照传（如果存在），让模型一次同时满足两边。
  const userInstructions = command.userInstructions?.trim();
  let reviewFeedback: OutlineReviewFeedback | undefined;
  if (!userInstructions) {
    if (!current) return { kind: "review_required" };
    if (current.review.result.status === "passed") return { kind: "no_revision_needed" };
  }
  if (current) {
    reviewFeedback = {
      status: current.review.result.status,
      summary: current.review.result.summary,
      issues: current.review.result.issues,
      hiddenPrerequisites: current.review.result.hiddenPrerequisites,
      complexDependencies: current.review.result.complexDependencies
    };
  }

  const model = resolveOutlineModel(command.model, dependencies.defaultModel);
  let generated;
  try {
    generated = await dependencies.generator.generate({
      topic: article.topic,
      targetAudience: describeAudience(article.styleProfile.audience),
      lengthPreset: article.planning.lengthPreset,
      wordRange: LENGTH_RANGES[article.planning.lengthPreset],
      currentBrief: article.brief,
      currentOutline: article.outline.map((section) => ({
        key: section.id,
        title: section.title,
        goal: section.goal ?? section.title,
        recommendedWords: section.recommendedWords ?? 50
      })),
      ...(reviewFeedback ? { reviewFeedback } : {}),
      ...(userInstructions ? { userInstructions } : {}),
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
  } catch (error) {
    return {
      kind: "generator_error",
      message: error instanceof Error ? error.message : userInstructions ? "按你的要求修改大纲失败" : "按审核意见修改大纲失败"
    };
  }

  const outline: OutlineSection[] = generated.outline.map((section, order) => ({
    id: randomUUID(),
    title: section.title,
    goal: section.goal,
    recommendedWords: section.recommendedWords,
    order
  }));
  const result = await dependencies.workflow.saveGeneratedOutline({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    reason: "review_applied",
    title: generated.workingTitle,
    brief: generated.brief,
    outline,
    lengthPreset: article.planning.lengthPreset,
    recommendedTotalWords: generated.recommendedTotalWords,
    sourceContextSnapshot: sourceContext
  });
  return result.kind === "saved" ? { kind: "revised", article: result.article, revision: result.revision } : result;
}
