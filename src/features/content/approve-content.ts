import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { Article } from "@/features/articles/domain";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { createContentSnapshot, isContentBasedOnCurrentOutline } from "./content-version";
import type { ContentReviewResult } from "./ports";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface ApproveContentCommand {
  articleId: string;
  expectedUpdatedAt: string;
  acknowledgeWarnings: boolean;
}

export interface ApproveContentDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  workflow: ContentWorkflowRepository;
}

export type ApproveContentResult =
  | {
      kind: "approved";
      article: Article;
      revision: ArticleRevision<ContentRevisionSnapshot>;
      /** 审核是可选步骤：未经审核直接确认时为 null。 */
      review: ArticleReview<ContentReviewResult> | null;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "stale_outline" }
  | { kind: "blocked" }
  | { kind: "acknowledgement_required" };

export async function approveContent(
  command: ApproveContentCommand,
  dependencies: ApproveContentDependencies
): Promise<ApproveContentResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!article.planning.confirmedOutlineRevisionId || article.outline.length === 0) {
    return { kind: "not_ready" };
  }
  if (!isContentBasedOnCurrentOutline(article)) return { kind: "stale_outline" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  let snapshot: ContentRevisionSnapshot;
  try {
    snapshot = createContentSnapshot(article, sourceContext);
  } catch {
    return { kind: "not_ready" };
  }

  // 审核可选：当前快照有匹配审核时按审核结论放行（blocked 阻断、needs_revision 需知悉）；
  // 没有审核记录时允许直接确认——确认的是内容本身，审核只是建议环节。
  const current = await dependencies.workflow.findCurrentContentReview({ articleId: article.id, snapshot });
  if (current?.review.result.status === "blocked") return { kind: "blocked" };
  if (
    current?.review.result.status === "needs_revision" && !command.acknowledgeWarnings
  ) {
    return { kind: "acknowledgement_required" };
  }

  let revision = current?.revision ?? null;
  if (!revision) {
    revision = await dependencies.workflow.findCurrentContentRevision({ articleId: article.id, snapshot });
  }
  if (!revision) {
    // 手动编辑后的正文还没有对应版本：先落一条 checkpoint 修订再确认，
    // 保持「确认的必须是已存档版本」的不变量（checkpoint 不改动 updatedAt，无并发冲突）。
    const checkpointed = await dependencies.workflow.checkpointContent({
      articleId: article.id,
      expectedUpdatedAt: command.expectedUpdatedAt,
      model: null,
      snapshot
    });
    if (checkpointed.kind !== "checkpointed") {
      return checkpointed.kind === "conflict" ? { kind: "conflict" } : { kind: "not_ready" };
    }
    revision = checkpointed.revision;
  }

  const saved = await dependencies.workflow.approveContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    revisionId: revision.id,
    ...(current ? { reviewId: current.review.id, reviewStatus: current.review.result.status } : {})
  });
  return saved.kind === "saved"
    ? { kind: "approved", article: saved.article, revision: saved.revision, review: current?.review ?? null }
    : saved;
}
