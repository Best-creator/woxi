import { randomUUID } from "node:crypto";
import {
  resolveStoryboardPresentation,
  type Article,
  type ArticlePlanning,
  type ContentBlock,
  type StoryboardPresentation
} from "@/features/articles/domain";
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
  /**
   * 呈现形态（界面上的「讲解式 / 剧情漫画」开关）：给了就以它为准并落库；
   * 没给按文章推断——没设计过分镜的新文默认剧情漫画，已设计过的旧文保持讲解式。
   */
  presentation?: StoryboardPresentation;
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
    segments: StoryboardSegmentPlan[],
    /** 与设计同一次落库的 planning 字段（呈现形态），避免多一次带乐观锁的写。 */
    planningPatch?: Partial<ArticlePlanning>
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
 * 段文案分块：模型被要求用空行把一段 copy 写成 2-4 个小块（每块只讲一件事），
 * 落库时每个小块一个段落块——段图拼接按块渲染文字带，块短了才读得下去。
 * 历史文章的 copy 没有空行，切完还是一块，行为不变。
 */
export function splitStoryboardCopy(copy: string): string[] {
  const parts = copy
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [copy.trim()];
}

/**
 * 把设计稿展开成正文块（展开桥的前半段）：
 * 每段 = 标题块（段落小标题）+ 若干文案块（copy 按空行分块，每块一个段落块），都带 segmentId。
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
    const copyParts = splitStoryboardCopy(segment.copy);
    const copyIds = copyParts.map(() => randomUUID());
    blocks.push({
      id: headingId,
      type: "heading",
      content: segment.title,
      order: blocks.length,
      level: 2,
      segmentId,
      version: 1
    });
    copyParts.forEach((part, index) => {
      blocks.push({
        id: copyIds[index]!,
        type: "paragraph",
        content: part,
        order: blocks.length,
        segmentId,
        version: 1
      });
    });
    plans.push({
      id: segmentId,
      sectionKey: segment.sectionKey,
      title: segment.title,
      route: segment.route,
      copyBlockIds: [headingId, ...copyIds],
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
  // 呈现形态：命令优先（界面上刚改的那个开关），没给就按文章推断。
  const presentation = command.presentation ?? resolveStoryboardPresentation(article.planning);
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
      presentation,
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
    sourceContextSnapshot: sourceContext,
    // 设计计划随版本快照保存：恢复这一版时按描述符重建帧，直接提交给第四步。
    storyboardSegments: plans.map((plan, index) => ({ ...plan, order: index }))
  });
  if (saved.kind === "conflict") return { kind: "conflict" };
  if (saved.kind !== "saved") {
    return { kind: "save_error", message: "保存正文失败，请刷新后重试" };
  }

  // 展开桥后半段：创建分镜帧资产 + 写 planning.storyboardSegments（顺带把呈现形态落库）。
  // 上一步返回的 updatedAt 是这两次写之间的乐观锁令牌。
  const planned = await dependencies.images.applyStoryboardPlan(
    article.id,
    saved.article.updatedAt,
    plans,
    { presentation }
  );
  if (planned.kind === "saved") {
    return { kind: "generated", article: planned.article, revision: saved.revision };
  }
  if (planned.kind === "conflict") return { kind: "conflict" };
  if (planned.kind === "not_found") return { kind: "not_found" };
  return { kind: "save_error", message: planned.message };
}
