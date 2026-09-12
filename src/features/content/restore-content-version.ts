import type { Article } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { createContentSnapshot } from "./content-version";
import { resolveContentModel } from "./model";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface RestoreContentVersionCommand {
  articleId: string;
  versionId: string;
  expectedUpdatedAt: string;
}

export interface RestoreContentVersionDependencies {
  workflow: ContentWorkflowRepository;
}

export type RestoreContentVersionResult =
  | { kind: "restored"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "version_not_found" }
  | { kind: "conflict" };

export async function restoreContentVersion(
  command: RestoreContentVersionCommand,
  dependencies: RestoreContentVersionDependencies
): Promise<RestoreContentVersionResult> {
  return dependencies.workflow.restoreContent({
    articleId: command.articleId,
    versionId: command.versionId,
    expectedUpdatedAt: command.expectedUpdatedAt
  });
}

export interface SaveContentVersionCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
}

export interface SaveContentVersionDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  workflow: ContentWorkflowRepository;
  defaultModel?: string;
}

export type SaveContentVersionResult =
  | { kind: "saved"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" };

export async function saveContentVersion(
  command: SaveContentVersionCommand,
  dependencies: SaveContentVersionDependencies
): Promise<SaveContentVersionResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  let snapshot: ContentRevisionSnapshot;
  try {
    snapshot = createContentSnapshot(article, sourceContext);
  } catch {
    return { kind: "not_ready" };
  }

  const saved = await dependencies.workflow.saveManualContentVersion({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model: resolveContentModel(command.model, dependencies.defaultModel),
    snapshot
  });
  return saved.kind === "saved"
    ? { kind: "saved", article: saved.article, revision: saved.revision }
    : saved;
}
