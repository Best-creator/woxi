import { randomUUID } from "node:crypto";
import { LENGTH_RANGES, type OutlineSection } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import { describeAudience } from "@/features/content/audience";
import type { SourceRepository } from "@/features/sources/repository";
import type { OutlineGenerator } from "./ports";
import { resolveOutlineModel } from "./model";
import type { OutlineWorkflowRepository } from "./workflow-repository";

export interface GenerateOutlineCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
  lengthPreset: keyof typeof LENGTH_RANGES;
}

export interface GenerateOutlineDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  generator: OutlineGenerator;
  workflow: OutlineWorkflowRepository;
  defaultModel?: string;
}

export type GenerateOutlineResult =
  | { kind: "generated"; article: import("@/features/articles/domain").Article; revision: import("@/features/revisions/domain").ArticleRevision<import("@/features/revisions/domain").OutlineRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "generator_error"; message: string };

export function readySourceContext(sources: Awaited<ReturnType<SourceRepository["list"]>>) {
  return sources
    .filter((source) => source.enabled && source.status === "ready")
    .map((source) => `【${source.title}】\n${source.content}`)
    .join("\n\n")
    .slice(0, 8_000);
}

export async function generateOutline(
  command: GenerateOutlineCommand,
  dependencies: GenerateOutlineDependencies
): Promise<GenerateOutlineResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const model = resolveOutlineModel(command.model, dependencies.defaultModel);
  let generated;
  try {
    generated = await dependencies.generator.generate({
      topic: article.topic,
      targetAudience: describeAudience(article.styleProfile.audience),
      lengthPreset: command.lengthPreset,
      wordRange: LENGTH_RANGES[command.lengthPreset],
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
  } catch (error) {
    return { kind: "generator_error", message: error instanceof Error ? error.message : "大纲生成失败" };
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
    title: generated.workingTitle,
    brief: generated.brief,
    outline,
    lengthPreset: command.lengthPreset,
    recommendedTotalWords: generated.recommendedTotalWords,
    sourceContextSnapshot: sourceContext,
    storyline: generated.storyline
  });
  return result.kind === "saved" ? { kind: "generated", article: result.article, revision: result.revision } : result;
}
