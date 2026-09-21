import type { ArticleRepository } from "@/features/articles/repository";
import { resolveStoryboardPresentation } from "@/features/articles/domain";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { createContentSnapshot, isContentBasedOnCurrentOutline, textBlocksOf } from "./content-version";
import { describeAudience } from "./audience";
import { resolveContentModel } from "./model";
import type { ContentReviewer, ReviewableStoryboardSegment } from "./ports";
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

/**
 * 把快照里的分镜段拍平成审核素材：文案从正文块取（快照的分镜段只存块 id），
 * 帧提示词与台词从快照帧描述符取——「画面里不许写字」「台词超长」这两条红线
 * 只存在于帧里，按块流水线是看不到的。
 *
 * 传进来的必须是**落库前被仓储补齐过帧描述符**的快照（checkpoint 返回的那份）：
 * createContentSnapshot 本地产出的快照帧为空，拿它审会漏掉全部画面类红线。
 */
export function reviewStoryboardSegments(
  snapshot: ContentRevisionSnapshot
): ReviewableStoryboardSegment[] {
  const segments = snapshot.storyboardSegments;
  if (!segments?.length) return [];
  const blockById = new Map(snapshot.textBlocks.map((block) => [block.id, block]));
  return [...segments]
    .sort((left, right) => left.order - right.order)
    .map((segment) => {
      const blocks = segment.copyBlockIds.flatMap((id) => {
        const block = blockById.get(id);
        return block ? [block] : [];
      });
      const heading = blocks.find((block) => block.type === "heading");
      return {
        blockIds: blocks.map((block) => block.id),
        title: heading?.content.trim() ?? segment.title,
        // 路由随快照带进审核：全篇「纯文字占比 ≥30%」与帧类红线的豁免都靠它。
        route: segment.route,
        copy: blocks
          .filter((block) => block.type !== "heading")
          .map((block) => block.content.trim())
          .join("\n\n"),
        frames: segment.frames.map((frame) => ({
          prompt: frame.prompt,
          ...(frame.speechLine ? { speechLine: frame.speechLine } : {})
        }))
      };
    })
    // 文案块全丢的段（历史脏数据）定位不到界面，跳过它而不是报一堆无处可点的问题。
    .filter((segment) => segment.blockIds.length > 0);
}

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

  // 分镜素材取自 checkpoint 落库的那份快照：仓储在这里刚把帧描述符补齐，
  // 本地那份的 frames 还是空的。
  const storyboardSegments = reviewStoryboardSegments(checkpoint.revision.snapshot);

  let result;
  try {
    result = await dependencies.reviewer.review({
      topic: article.topic,
      // 审核用的受众取自这一版正文的快照，而不是文章当前设置：
      // 否则改过受众之后，回看旧版本会被按新受众打分。
      targetAudience: describeAudience(snapshot.styleProfile.audience),
      styleProfile: snapshot.styleProfile,
      // 形态取自文章（生成时落库）：剧情漫画的文案要按剧情漫画的红线审。
      presentation: resolveStoryboardPresentation(article.planning),
      blocks: snapshot.textBlocks.map((block) => ({
        id: block.id,
        type: block.type,
        content: block.content,
        order: block.order
      })),
      ...(storyboardSegments.length ? { storyboardSegments } : {}),
      // 全篇字数预算（快照口径）：审核据此给出超预算警告。
      recommendedTotalWords: snapshot.recommendedTotalWords,
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
