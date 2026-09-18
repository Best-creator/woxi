import type { Article } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { StoryboardRevisionSegmentPlan } from "@/features/images/repository";
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
  /**
   * 分镜重建计划落地：恢复旧版本时帧已缺失的段按快照描述符重建占位帧，
   * 仍存活的帧原样保留（applyStoryboardRevision 的保留/重建语义）。
   * 缺省时跳过重建（旧数据/部分测试），帧缺失由设计视图提示重新生成。
   */
  images?: {
    applyStoryboardRevision: (
      articleId: string,
      expectedUpdatedAt: string,
      segments: StoryboardRevisionSegmentPlan[]
    ) => Promise<
      | { kind: "saved"; article: Article; removedFilePaths: string[] }
      | { kind: "not_found" }
      | { kind: "conflict" }
      | { kind: "invalid_state"; message: string }
    >;
  };
}

export type RestoreContentVersionResult =
  | { kind: "restored"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "storyboard_conflict"; message: string }
  | { kind: "not_found" }
  | { kind: "version_not_found" }
  | { kind: "conflict" };

export async function restoreContentVersion(
  command: RestoreContentVersionCommand,
  dependencies: RestoreContentVersionDependencies
): Promise<RestoreContentVersionResult> {
  const restored = await dependencies.workflow.restoreContent({
    articleId: command.articleId,
    versionId: command.versionId,
    expectedUpdatedAt: command.expectedUpdatedAt
  });
  if (restored.kind !== "restored") return restored;

  // 快照里帧已缺失的段：按描述符重建占位帧（仍存活的段保留绑定），正文版本重新提交给第四步。
  const plans = restored.storyboardPlans;
  if (!plans?.length || !dependencies.images) return restored;
  const planned = await dependencies.images.applyStoryboardRevision(
    command.articleId,
    restored.article.updatedAt,
    plans
  );
  if (planned.kind === "saved") {
    return { kind: "restored", article: planned.article, revision: restored.revision };
  }
  if (planned.kind === "conflict") return { kind: "conflict" };
  if (planned.kind === "not_found") return { kind: "not_found" };
  return { kind: "storyboard_conflict", message: planned.message };
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
