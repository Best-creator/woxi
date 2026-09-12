import type { Article } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ContentGenerator } from "./content-generator";
import type { SourceRepository } from "@/features/sources/repository";

export type GenerateFoundationResult =
  | { kind: "generated"; article: Article }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" };

export async function generateFoundation(
  articleId: string,
  expectedUpdatedAt: string,
  repository: ArticleRepository,
  generator: ContentGenerator,
  sourceRepository?: SourceRepository,
  model?: string
): Promise<GenerateFoundationResult> {
  const article = await repository.findById(articleId);
  if (!article) {
    return { kind: "not_found" };
  }
  if (article.updatedAt !== expectedUpdatedAt) {
    return { kind: "conflict" };
  }
  if (
    !article.brief ||
    article.outline.length === 0 ||
    !article.outlineConfirmedAt ||
    !article.planning.confirmedOutlineRevisionId
  ) {
    return { kind: "not_ready" };
  }

  const sources = sourceRepository ? await sourceRepository.list(article.id) : [];
  const sourceContext = sources
    .filter((source) => source.enabled && source.status === "ready")
    .map((source) => `【${source.title}】\n${source.content}`)
    .join("\n\n")
    .slice(0, 8_000);
  const generated = await generator.generate({
    topic: article.topic,
    brief: article.brief,
    outline: article.outline,
    lengthPreset: article.planning.lengthPreset,
    ...(sourceContext ? { sourceContext } : {}),
    ...(model ? { model } : {})
  });
  const saveResult = await repository.save(
    {
      ...article,
      title: generated.title,
      blocks: generated.blocks,
      status: "editing",
      planning: {
        ...article.planning,
        contentOutlineRevisionId: article.planning.confirmedOutlineRevisionId
      }
    },
    expectedUpdatedAt
  );

  return saveResult.kind === "conflict"
    ? { kind: "conflict" }
    : { kind: "generated", article: saveResult.article };
}
