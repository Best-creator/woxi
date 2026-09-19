import { randomUUID } from "node:crypto";
import {
  resolveStoryboardPresentation,
  type Article,
  type ContentBlock,
  type StoryboardSegment
} from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { SourceRepository } from "@/features/sources/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import { withStripsRestored } from "@/features/images/consumed-content";
import type { ImageAsset } from "@/features/images/domain";
import type { StoryboardRevisionSegmentPlan } from "@/features/images/repository";
import type {
  ArticleRevision,
  ContentRevisionSnapshot,
  StoryboardSnapshotSegment
} from "@/features/revisions/domain";
import { contentIsReady, splitStoryboardCopy } from "./generate-content";
import { describeAudience } from "./audience";
import { validateStoryboardDesign } from "./openai-storyboard-designer";
import type {
  ReviseStoryboardDesignInput,
  StoryboardDesign,
  StoryboardDesigner,
  StoryboardDesignFrame,
  StoryboardDesignSegment,
  StoryboardReviewFeedback
} from "./ports";
import { resolveContentModel } from "./model";
import type { StyleProfile } from "./style-profile";
import { tryCreateContentSnapshot } from "./content-version";
import type { ContentWorkflowRepository } from "./workflow-repository";

export interface ReviseStoryboardCommand {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
  styleProfile: StyleProfile;
  drawingStyle?: string;
  character?: { name: string; persona: string; description: string };
  /** 作者自己提的修改要求；给了它就不再要求先有审核记录。 */
  userInstructions?: string;
}

export interface ReviseStoryboardDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  designer: StoryboardDesigner;
  workflow: ContentWorkflowRepository;
  /** 只依赖帧资产读取与分镜修订落库，方便测试注入假仓储。 */
  images: {
    list: (articleId: string) => Promise<ImageAsset[]>;
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
  defaultModel?: string;
}

export type ReviseStoryboardResult =
  | {
      kind: "revised";
      article: Article;
      revision: ArticleRevision<ContentRevisionSnapshot>;
      /** 内容有变化、帧资产被替换的段数。 */
      replacedSegments: number;
      /** 内容未变、已生成帧资产原样保留的段数。 */
      retainedSegments: number;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "stale_outline" }
  | { kind: "no_storyboard" }
  | { kind: "review_required" }
  | { kind: "no_revision_needed" }
  | { kind: "designer_error"; message: string }
  | { kind: "save_error"; message: string };

/** 段内容是否逐字未变：未变的段才能沿用旧段 id 与帧资产（保住已生成的图）。
 *  copy 先归一化空行再比——分块落库后「还原视图」的空行数与模型原话可能有出入，内容一致就该算未变。
 *  台词同样参与比对：模型改了台词而帧没换的话，资产上的旧台词会被静默保留，修订等于没生效。 */
function sameSegment(left: StoryboardDesignSegment, right: StoryboardDesignSegment): boolean {
  if (left.title.trim() !== right.title.trim()) return false;
  if (left.route !== right.route) return false;
  if (canonicalCopy(left.copy) !== canonicalCopy(right.copy)) return false;
  if (left.frames.length !== right.frames.length) return false;
  return left.frames.every((frame, index) => {
    const other = right.frames[index];
    return Boolean(other) &&
      frame.prompt.trim() === other!.prompt.trim() &&
      frame.altText.trim() === other!.altText.trim() &&
      canonicalSpeechLine(frame.speechLine) === canonicalSpeechLine(other!.speechLine);
  });
}

/** 台词的比对口径：null/undefined 等同「没有」，text 归一化首尾空白。 */
function canonicalSpeechLine(line: StoryboardDesignFrame["speechLine"]): string {
  if (!line?.text.trim()) return "";
  return `${line.kind}|${line.text.trim()}`;
}

/** 归一化空行（≥2 个换行折叠成正好一个空行），与 splitStoryboardCopy 的分块口径一致。 */
function canonicalCopy(copy: string): string {
  return copy.trim().replace(/\n{2,}/g, "\n\n");
}

/**
 * 把当前 planning 段还原成完整分镜设计（文案取自正文块、帧取自资产）。
 * 返回 planning 段与设计段的配对，diff 时按 sectionKey 队列对齐。
 * 分块落库的段把各文案块用空行拼回整段 copy——与设计器的分块口径互为逆操作。
 */
function restoreCurrentDesign(
  article: Article,
  assets: ImageAsset[]
): Array<{ plan: StoryboardSegment; design: StoryboardDesignSegment }> {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const blocksById = new Map(
    withStripsRestored(article.blocks, assets).map((block) => [block.id, block])
  );
  const pairs: Array<{ plan: StoryboardSegment; design: StoryboardDesignSegment }> = [];
  for (const plan of [...(article.planning.storyboardSegments ?? [])].sort(
    (left, right) => left.order - right.order
  )) {
    const copyBlocks = plan.copyBlockIds
      .map((id) => blocksById.get(id))
      .filter((block): block is ContentBlock => Boolean(block));
    const heading = copyBlocks.find((block) => block.type === "heading");
    const copy = copyBlocks
      .filter((block) => block.type !== "heading")
      .map((block) => block.content)
      .join("\n\n");
    const frames = plan.frameAssetIds.flatMap((id) => {
      const asset = assetById.get(id);
      return asset
        ? [
            {
              prompt: asset.prompt,
              altText: asset.altText,
              ...(asset.speechLine ? { speechLine: asset.speechLine } : {})
            }
          ]
        : [];
    });
    // 结构残缺的段（块或帧丢失）不进修订输入：模型看不到就改不到，落库时随新设计退役。
    if (!copy.trim() || !frames.length) continue;
    pairs.push({
      plan,
      design: {
        sectionKey: plan.sectionKey,
        title: heading?.content.trim() || plan.title,
        route: plan.route,
        copy,
        frames
      }
    });
  }
  return pairs;
}

/**
 * 按审核意见 / 作者要求修订分镜（对齐 applyOutlineReview 的双入口收敛）：
 * 设计器返回完整设计，这里与当前设计逐段 diff——
 * 未变的段沿用旧段 id 与帧资产（已生成的图不动），只有内容变化的段才替换。
 */
export async function reviseStoryboard(
  command: ReviseStoryboardCommand,
  dependencies: ReviseStoryboardDependencies
): Promise<ReviseStoryboardResult> {
  const article = await dependencies.articles.findById(command.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== command.expectedUpdatedAt) return { kind: "conflict" };
  if (!contentIsReady(article) || !article.brief) return { kind: "not_ready" };
  if (
    !article.planning.contentOutlineRevisionId ||
    article.planning.contentOutlineRevisionId !== article.planning.confirmedOutlineRevisionId
  ) {
    return { kind: "stale_outline" };
  }
  const sourceContext = readySourceContext(await dependencies.sources.list(article.id));
  const assets = await dependencies.images.list(article.id);
  const currentPairs = restoreCurrentDesign(article, assets);
  if (!currentPairs.length) return { kind: "no_storyboard" };

  const userInstructions = command.userInstructions?.trim();
  const snapshot = tryCreateContentSnapshot(article, sourceContext);
  const current = snapshot
    ? await dependencies.workflow.findCurrentContentReview({
        articleId: article.id,
        snapshot
      })
    : null;

  // 有用户自述要求时不再拿审核状态当闸门（与改大纲同一约定）。
  let reviewFeedback: StoryboardReviewFeedback | undefined;
  if (!userInstructions) {
    if (!current) return { kind: "review_required" };
    if (current.review.result.status === "passed") return { kind: "no_revision_needed" };
  }
  if (current) {
    reviewFeedback = {
      status: current.review.result.status,
      summary: current.review.result.summary,
      issues: current.review.result.issues
    };
  }

  // 审核点名的段：issue.blockIds ∩ 段文案块 → sectionKey。
  const flaggedSectionKeys = new Set<string>();
  if (reviewFeedback) {
    const sectionByBlockId = new Map<string, string>();
    for (const { plan } of currentPairs) {
      for (const blockId of plan.copyBlockIds) sectionByBlockId.set(blockId, plan.sectionKey);
    }
    for (const issue of reviewFeedback.issues) {
      for (const blockId of issue.blockIds) {
        const sectionKey = sectionByBlockId.get(blockId);
        if (sectionKey) flaggedSectionKeys.add(sectionKey);
      }
    }
  }

  const model = resolveContentModel(command.model, dependencies.defaultModel);
  const reviseInput: ReviseStoryboardDesignInput = {
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
    // 形态从文章推断（生成时就落库了）：修订必须用与初版同一套编排提示词与红线。
    presentation: resolveStoryboardPresentation(article.planning),
    currentDesign: {
      title: article.title,
      segments: currentPairs.map((pair) => pair.design)
    },
    flaggedSectionKeys: [...flaggedSectionKeys],
    ...(reviewFeedback ? { reviewFeedback } : {}),
    ...(userInstructions ? { userInstructions } : {}),
    ...(command.drawingStyle ? { drawingStyle: command.drawingStyle } : {}),
    ...(command.character ? { character: command.character } : {}),
    ...(sourceContext ? { sourceContext } : {}),
    model
  };
  let design: StoryboardDesign;
  try {
    design = await dependencies.designer.revise(reviseInput);
    // 修订稿与初稿共用同一道结构闸：章节覆盖、路由-帧数、总字数。
    design = validateStoryboardDesign(design, reviseInput);
  } catch (error) {
    return {
      kind: "designer_error",
      message: error instanceof Error ? error.message : userInstructions ? "按你的要求修订分镜失败" : "按审核意见修订分镜失败"
    };
  }

  // 逐段 diff：按 sectionKey 队列对齐，未变的段沿用旧段 id、文案块 id 与帧资产。
  const queueByKey = new Map<string, typeof currentPairs>();
  for (const pair of currentPairs) {
    const queue = queueByKey.get(pair.plan.sectionKey) ?? [];
    queue.push(pair);
    queueByKey.set(pair.plan.sectionKey, queue);
  }

  const restoredById = new Map(
    withStripsRestored(article.blocks, assets).map((block) => [block.id, block])
  );
  const textBlocks: ContentBlock[] = [];
  const plans: StoryboardRevisionSegmentPlan[] = [];
  let retainedSegments = 0;
  let replacedSegments = 0;
  for (const segment of design.segments) {
    const queue = queueByKey.get(segment.sectionKey) ?? [];
    const matchedIndex = queue.findIndex((pair) => sameSegment(pair.design, segment));
    const matched = matchedIndex >= 0 ? queue.splice(matchedIndex, 1)[0] : undefined;
    if (matched) {
      retainedSegments += 1;
      for (const blockId of matched.plan.copyBlockIds) {
        const block = restoredById.get(blockId);
        if (block) textBlocks.push(block);
      }
      plans.push({
        id: matched.plan.id,
        sectionKey: matched.plan.sectionKey,
        title: segment.title,
        route: segment.route,
        copyBlockIds: [...matched.plan.copyBlockIds],
        frames: [],
        retainedFrameAssetIds: [...matched.plan.frameAssetIds]
      });
      continue;
    }
    replacedSegments += 1;
    const segmentId = randomUUID();
    const headingId = randomUUID();
    const copyParts = splitStoryboardCopy(segment.copy);
    const copyIds = copyParts.map(() => randomUUID());
    textBlocks.push({
      id: headingId,
      type: "heading",
      content: segment.title,
      order: textBlocks.length,
      level: 2,
      segmentId,
      version: 1
    });
    copyParts.forEach((part, index) => {
      textBlocks.push({
        id: copyIds[index]!,
        type: "paragraph",
        content: part,
        order: textBlocks.length,
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
        altText: frame.altText,
        ...(frame.speechLine ? { speechLine: frame.speechLine } : {})
      }))
    });
  }

  // 快照随版本保存本次修订后的设计：保留段记下帧资产 id 与描述符（图还在），
  // 替换段记下帧描述符（恢复这一版时按它重建占位帧重新出图）。
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotSegments: StoryboardSnapshotSegment[] = plans.map((plan, index) => ({
    id: plan.id,
    sectionKey: plan.sectionKey,
    title: plan.title,
    route: plan.route,
    copyBlockIds: plan.copyBlockIds,
    order: index,
    frames: plan.retainedFrameAssetIds?.length
      ? plan.retainedFrameAssetIds.flatMap((id) => {
          const asset = assetById.get(id);
          return asset
            ? [
                {
                  prompt: asset.prompt,
                  altText: asset.altText,
                  aspectRatio: asset.aspectRatio,
                  ...(asset.speechLine ? { speechLine: asset.speechLine } : {})
                }
              ]
            : [];
        })
      : plan.frames,
    ...(plan.retainedFrameAssetIds?.length
      ? { frameAssetIds: [...plan.retainedFrameAssetIds] }
      : {})
  }));

  // 落库第一步：正文块与版本（reason=review_applied，与改大纲同款）。
  const saved = await dependencies.workflow.saveGeneratedContent({
    articleId: article.id,
    expectedUpdatedAt: command.expectedUpdatedAt,
    model,
    title: design.title.trim() || article.title,
    textBlocks,
    styleProfile: command.styleProfile,
    sourceContextSnapshot: sourceContext,
    reason: "review_applied",
    storyboardSegments: snapshotSegments
  });
  if (saved.kind === "conflict") return { kind: "conflict" };
  if (saved.kind !== "saved") {
    return { kind: "save_error", message: "保存修订失败，请刷新后重试" };
  }

  // 落库第二步：外科手术式替换帧资产——保留段不动，改动段新建占位帧。
  const planned = await dependencies.images.applyStoryboardRevision(
    article.id,
    saved.article.updatedAt,
    plans
  );
  if (planned.kind === "saved") {
    return {
      kind: "revised",
      article: planned.article,
      revision: saved.revision,
      replacedSegments,
      retainedSegments
    };
  }
  if (planned.kind === "conflict") return { kind: "conflict" };
  if (planned.kind === "not_found") return { kind: "not_found" };
  return { kind: "save_error", message: planned.message };
}
