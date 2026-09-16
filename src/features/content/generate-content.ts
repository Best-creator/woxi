import { randomUUID } from "node:crypto";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import type { ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import { describeAudience } from "./audience";
import type { StoryboardDesigner, StoryboardDesign } from "./ports";
import { resolveContentModel } from "./model";
import type { StyleProfile } from "./style-profile";
import type { ContentWorkflowRepository } from "./workflow-repository";
import type { StoryboardSegmentPlan } from "@/features/images/repository";

export interface GenerateContentCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
  styleProfile: StyleProfile;
  /** 绘制风格；缺省时设计器按默认（日系动漫）设计分镜。 */
  drawingStyle?: string;
  /** 参考形象摘要（名称 + 身份 + 外形基准），烘进每帧分镜 prompt。 */
  character?: { name: string; persona: string; description: string };
}

export interface GenerateContentDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  /** 第三步改为「设计正文分镜」：设计器一次产出路由 + 成稿文案 + 分镜帧。 */
  designer: StoryboardDesigner;
  workflow: ContentWorkflowRepository;
  /** 分镜展开桥：创建帧资产 + 写 planning.storyboardSegments。 */
  images: Pick<ImageAssetRepositoryLike, "applyStoryboardPlan">;
  defaultModel?: string;
}

/** 最小接口：只依赖分镜落库，方便测试注入假仓储。 */
interface ImageAssetRepositoryLike {
  applyStoryboardPlan: (
    articleId: string,
    expectedUpdatedAt: string,
    segments: StoryboardSegmentPlan[]
  ) => Promise<
    | { kind: "saved"; article: Article; removedFilePaths: string[] }
    | { kind: "not_found" }
    | { kind: "conflict" }
    | { kind: "invalid_state"; message: string }
  >;
}

export type GenerateContentResult =
  | { kind: "generated"; article: Article; revision: ArticleRevision<ContentRevisionSnapshot> }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "designer_error"; message: string }
  | { kind: "save_error"; message: string };

export function contentIsReady(article: Article): boolean {
  return Boolean(
    article.brief &&
    article.outline.length > 0 &&
    article.outlineConfirmedAt &&
    article.planning.confirmedOutlineRevisionId &&
    article.planning.recommendedTotalWords !== null
  );
}

/**
 * 把设计稿展开成正文块（展开桥的前半段）：
 * 每段 = 标题块（段落小标题）+ 文案块（成稿文案），都带 segmentId。
 * 分镜帧不进正文块——它们是 image_assets 里的分镜资产，
 * 段图拼接阶段再按路由把文案烘进图里。
 */
function buildSegmentBlocks(design: StoryboardDesign): {
  blocks: ContentBlock[];
  plans: StoryboardSegmentPlan[];
} {
  const blocks: ContentBlock[] = [];
  const plans: StoryboardSegmentPlan[] = [];
  for (const segment of design.segments) {
    const segmentId = randomUUID();
    const headingId = randomUUID();
    const copyId = randomUUID();
    blocks.push({
      id: headingId,
      type: "heading",
      content: segment.title,
      order: blocks.length,
      level: 2,
      segmentId,
      version: 1
    });
    blocks.push({
      id: copyId,
      type: "paragraph",
      content: segment.copy,
      order: blocks.length,
      segmentId,
      version: 1
    });
    plans.push({
      id: segmentId,
      sectionKey: segment.sectionKey,
      title: segment.title,
      route: segment.route,
      copyBlockIds: [headingId, copyId],
      frames: segment.frames.map((frame) => ({
        prompt: frame.prompt,
        altText: frame.altText
      }))
    });
  }
  return { blocks, plans };
}

export async function generateContent(
  command: GenerateContentCommand,
  dependencies: GenerateContentDependencies
): Promise<GenerateContentResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!contentIsReady(article) || !article.brief) return { kind: "not_ready" };

  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const model = resolveContentModel(command.model, dependencies.defaultModel);
  let blocks: ContentBlock[];
  let plans: StoryboardSegmentPlan[];
  let title: string;
  try {
    // 受众跟着提交上来的风格走（用户可能刚在界面上改过），不是文章里存的旧值。
    const design = await dependencies.designer.design({
      topic: article.topic,
      targetAudience: describeAudience(command.styleProfile.audience),
      brief: article.brief,
      outline: article.outline.map((section) => ({
        id: section.id,
        title: section.title,
        ...(section.goal ? { goal: section.goal } : {}),
        ...(section.recommendedWords ? { recommendedWords: section.recommendedWords } : {}),
        order: section.order
      })),
      recommendedTotalWords: article.planning.recommendedTotalWords as number,
      styleProfile: command.styleProfile,
      ...(command.drawingStyle ? { drawingStyle: command.drawingStyle } : {}),
      ...(command.character ? { character: command.character } : {}),
      ...(sourceContext ? { sourceContext } : {}),
      model
    });
    const expanded = buildSegmentBlocks(design);
    blocks = expanded.blocks;
    plans = expanded.plans;
    // 设计器给出的「最终标题」才是成稿标题；为空时保留原标题，避免把标题清空。
    title = design.title.trim() || article.title;
  } catch (error) {
    return {
      kind: "designer_error",
      message: error instanceof Error ? error.message : "分镜设计失败，请稍后重试"
    };
  }

  const saved = await dependencies.workflow.saveGeneratedContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    title,
    textBlocks: blocks,
    styleProfile: command.styleProfile,
    sourceContextSnapshot: sourceContext
  });
  if (saved.kind === "conflict") return { kind: "conflict" };
  if (saved.kind !== "saved") {
    return { kind: "save_error", message: "保存正文失败，请刷新后重试" };
  }

  // 展开桥后半段：创建分镜帧资产 + 写 planning.storyboardSegments。
  // 上一步返回的 updatedAt 是这两次写之间的乐观锁令牌。
  const planned = await dependencies.images.applyStoryboardPlan(
    article.id,
    saved.article.updatedAt,
    plans
  );
  if (planned.kind === "saved") {
    return { kind: "generated", article: planned.article, revision: saved.revision };
  }
  if (planned.kind === "conflict") return { kind: "conflict" };
  if (planned.kind === "not_found") return { kind: "not_found" };
  return { kind: "save_error", message: planned.message };
}
