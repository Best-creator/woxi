import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import { removeGenerationFile } from "./generation-files";
import type { ImageGenerator } from "./image-generator";
import { ImageGeneratorError } from "./image-generator";
import { persistImage } from "./generate-image-asset";
import {
  buildGenerationEnhancements,
  generateWithEnhancementFallback,
  type GenerationEnhancementDependencies
} from "./generation-enhancements";
import type { ImageAssetRepository } from "./repository";

export type GenerateImageAssetsBatchResult =
  | {
      kind: "saved";
      article: Article;
      assets: ImageAsset[];
      /** 逐张结果：ok=false 的张数就是「继续生成」按钮要补的量。 */
      results: Array<{ assetId: string; ok: boolean; message?: string }>;
      succeeded: number;
      failed: number;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "nothing_pending" };

export interface GenerateImageAssetsBatchDependencies extends GenerationEnhancementDependencies {
  images: ImageAssetRepository;
  generator: ImageGenerator;
  /** 生成文件的落盘目录（默认 .data/generated-images），测试可注入临时目录。 */
  storageDir?: string;
}

export interface GenerateImageAssetsBatchInput {
  articleId: string;
  expectedUpdatedAt: string;
  model?: string;
}

function readableGeneratorError(error: unknown) {
  if (error instanceof ImageGeneratorError) return error.message;
  return "图片生成失败，请稍后重试";
}

function isPending(asset: ImageAsset) {
  return asset.status !== "disabled" && asset.status !== "generated" && asset.status !== "generating";
}

/**
 * 批量并行生成一批配图：
 *
 * 1. 串行 beginGeneration 占位——每次都是独立的快事务，乐观锁令牌逐张推进，
 *    不破坏「文章级写操作必须带 expectedUpdatedAt」的并发契约（前端直接并行打
 *    单张接口才会 409，这正是串行循环当初存在的原因）；
 * 2. 全部置为 generating 后，慢的上游生图调用并行跑，总耗时≈最慢一张；
 * 3. 结果串行落库（complete/fail 同样逐张推进令牌），文件名与版本记录用同一个 id。
 *
 * 中途撞锁（批量进行期间文章在别处被更新）时停止落库：已保存的版本保留，
 * 返回 saved + 摘要；一张都没落成则返回 conflict。撞锁后仍处 generating 的
 * 尾巴与单张生成的同类情况一致，刷新后用「重建占位图」恢复。
 */
export async function generateImageAssetsBatch(
  input: GenerateImageAssetsBatchInput,
  dependencies: GenerateImageAssetsBatchDependencies
): Promise<GenerateImageAssetsBatchResult> {
  const all = await dependencies.images.list(input.articleId);
  const pending = all.filter(isPending);
  if (!pending.length) return { kind: "nothing_pending" };

  // 画风/参考形象增强整批构建一次（同批帧共享同一份偏好）；读不到时是空增强。
  // 批量只有分镜帧：画风用单格裁剪版（画像里的整页排版对单格是错误指令）。
  const enhancements = await buildGenerationEnhancements(input.articleId, dependencies, { frame: true });

  // ── 阶段 1：串行占位。conflict/not_found 就整批不打上游。──
  let token = input.expectedUpdatedAt;
  const started: ImageAsset[] = [];
  for (const asset of pending) {
    const begin = await dependencies.images.beginGeneration(input.articleId, asset.id, token);
    if (begin.kind === "conflict") return { kind: "conflict" };
    if (begin.kind === "not_found") return { kind: "not_found" };
    if (begin.kind !== "saved") continue; // invalid_state：这张刚好被别人动过，跳过。
    token = begin.article.updatedAt;
    started.push(asset);
  }
  if (!started.length) return { kind: "nothing_pending" };

  // ── 阶段 2：上游并行生成，一张失败不影响其他张。──
  // 每张都带「被内容策略拦截就退回原始提示词」的降级（见 generateWithEnhancementFallback）：
  // 画风引导是逐帧前置的同一段长文本，一旦它触发拦截，整批会同时失败。
  const settled = await Promise.allSettled(
    started.map((asset) =>
      generateWithEnhancementFallback(dependencies.generator, asset, enhancements, input.model)
    )
  );

  // ── 阶段 3：串行落库，令牌继续逐张推进；中途撞锁即停。──
  const results: Array<{ assetId: string; ok: boolean; message?: string }> = [];
  let article: Article | null = null;
  let assets: ImageAsset[] = [];
  let locked = false;
  for (let index = 0; index < started.length; index += 1) {
    if (locked) {
      results.push({ assetId: started[index].id, ok: false, message: "文章已在其他位置更新，本张未保存" });
      continue;
    }
    const asset = started[index];
    const outcome = settled[index];
    const failure = await persistOneOutcome({
      articleId: input.articleId,
      asset,
      outcome,
      token,
      model: input.model,
      storageDir: dependencies.storageDir ?? resolve(process.cwd(), ".data", "generated-images"),
      images: dependencies.images
    });
    if (failure.conflict) {
      locked = true;
      results.push({ assetId: asset.id, ok: false, message: "文章已在其他位置更新，本张未保存" });
      continue;
    }
    if (failure.article && failure.assets && failure.assets.length) {
      token = failure.article.updatedAt;
      article = failure.article;
      assets = failure.assets;
    }
    results.push({ assetId: asset.id, ok: !failure.message, ...(failure.message ? { message: failure.message } : {}) });
  }

  if (!article || !assets.length) return { kind: "conflict" };
  const succeeded = results.filter((item) => item.ok).length;
  return {
    kind: "saved",
    article,
    assets,
    results,
    succeeded,
    failed: results.length - succeeded
  };
}

interface PersistOutcomeArgs {
  articleId: string;
  asset: ImageAsset;
  outcome: PromiseSettledResult<Awaited<ReturnType<ImageGenerator["generate"]>>>;
  token: string;
  model?: string;
  storageDir: string;
  images: ImageAssetRepository;
}

interface PersistOutcomeFailure {
  conflict: boolean;
  message?: string;
  article?: Article;
  assets?: ImageAsset[];
}

/** 落库单张结果：成功写版本、失败记 failed；返回新的聚合与令牌推进所需的最新文章。 */
async function persistOneOutcome(args: PersistOutcomeArgs): Promise<PersistOutcomeFailure> {
  const { articleId, asset, outcome, token, model, storageDir, images } = args;
  try {
    if (outcome.status === "rejected") {
      throw outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
    }
    const payload = outcome.value;
    const generationId = randomUUID();
    let filePath: string | null = null;
    if (payload.binary) {
      filePath = await persistImage(payload.binary, payload.format, asset.id, generationId, storageDir);
    }
    if (!payload.remoteUrl && !filePath) {
      throw new ImageGeneratorError("invalid_response", "图片生成服务返回了无效结果。");
    }
    const completed = await images.completeGeneration(articleId, asset.id, token, {
      publicUrl: payload.remoteUrl,
      filePath,
      generationId,
      ...(model ? { model } : {})
    });
    if (completed.kind !== "saved") {
      // 版本没落库，刚写的文件就是孤儿，直接清掉。
      await removeGenerationFile(filePath);
      if (completed.kind === "conflict") return { conflict: true };
      return { conflict: false, message: completed.kind === "invalid_state" ? completed.message : "图片保存失败" };
    }
    return { conflict: false, article: completed.article, assets: completed.assets };
  } catch (error) {
    const failed = await images.failGeneration(articleId, asset.id, token);
    if (failed.kind === "conflict") return { conflict: true };
    if (failed.kind === "saved") {
      return { conflict: false, message: readableGeneratorError(error), article: failed.article, assets: failed.assets };
    }
    return { conflict: false, message: readableGeneratorError(error) };
  }
}
