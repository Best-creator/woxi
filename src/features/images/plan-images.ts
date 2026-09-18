import type { Article } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAsset } from "./domain";
import { VisualPlannerError } from "./openai-visual-planner";
import type { ImageAssetRepository } from "./repository";
import type { VisualCharacterBrief, VisualPlanner } from "./visual-planner";

export type PlanImagesResult =
  | { kind: "planned"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "no_content" }
  | { kind: "stale_content" }
  | { kind: "storyboard_locked" }
  | { kind: "conflict" }
  | { kind: "invalid_plan"; source: "repository"; message: string }
  | { kind: "planner_error"; message: string };

function plannerErrorMessage(error: unknown) {
  if (error instanceof VisualPlannerError) {
    if (error.code === "timeout") return "配图分析超时，请重试";
    if (error.code === "authentication") return "LLM 配置无效，请检查 env/.env.local";
  }
  return "配图分析失败，请稍后重试";
}

export async function planImages(
  articleId: string,
  expectedUpdatedAt: string,
  articles: ArticleRepository,
  images: ImageAssetRepository,
  planner: VisualPlanner,
  options?: { model?: string; style?: string; character?: VisualCharacterBrief }
): Promise<PlanImagesResult> {
  const article = await articles.findById(articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== expectedUpdatedAt) return { kind: "conflict" };

  // 正文基于旧大纲时不允许产出新配图计划；两处都为空的历史文章不受影响。
  const confirmedOutlineRevisionId = article.planning.confirmedOutlineRevisionId;
  if (confirmedOutlineRevisionId && article.planning.contentOutlineRevisionId !== confirmedOutlineRevisionId) {
    return { kind: "stale_content" };
  }

  // 第三步已设计过分镜的文章不再走视觉规划器：规划会把第三步的帧资产
  // 删掉/禁用（applyPlan 的让位语义），两套「设计分镜」互相打架。
  // 这类文章的配图 = 直接生成第三步的帧，第四步不再提供规划入口。
  if (article.planning.storyboardSegments?.length) {
    return { kind: "storyboard_locked" };
  }

  const blocks = article.blocks.filter((block) => block.type !== "image");
  if (blocks.length === 0) return { kind: "no_content" };

  let plan;
  try {
    plan = await planner.plan({
      title: article.title,
      topic: article.topic,
      blocks,
      ...(options?.style?.trim() ? { style: options.style.trim() } : {}),
      ...(options?.character ? { character: options.character } : {}),
      ...(options?.model ? { model: options.model } : {})
    });
  } catch (error) {
    return { kind: "planner_error", message: plannerErrorMessage(error) };
  }

  const result = await images.applyPlan(articleId, expectedUpdatedAt, plan.suggestions, plan.stripDecision);
  if (result.kind === "saved") {
    return { kind: "planned", article: result.article, assets: result.assets };
  }
  if (result.kind === "not_found") return { kind: "not_found" };
  if (result.kind === "conflict") return { kind: "conflict" };
  if (result.kind === "invalid_plan") {
    return { kind: "invalid_plan", source: "repository", message: result.message };
  }
  return {
    kind: "invalid_plan",
    source: "repository",
    message: "图片规划内容无效，请重试"
  };
}
