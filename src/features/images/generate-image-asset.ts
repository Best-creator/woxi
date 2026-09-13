import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import type { ImageAssetRepository, ImagePlanMutationResult } from "./repository";
import { ImageGeneratorError } from "./image-generator";
import type { ImageGenerator } from "./image-generator";

export type GenerateImageAssetResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid_state"; message: string }
  | { kind: "generator_error"; message: string };

export interface GenerateImageAssetDependencies {
  images: ImageAssetRepository;
  generator: ImageGenerator;
  /** 生成文件的落盘目录（默认 .data/generated-images），测试可注入临时目录。 */
  storageDir?: string;
}

const EXTENSION_BY_FORMAT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp"
};

function mapMutation(result: ImagePlanMutationResult): GenerateImageAssetResult {
  if (result.kind === "not_found") return { kind: "not_found" };
  if (result.kind === "conflict") return { kind: "conflict" };
  return {
    kind: "invalid_state",
    message: result.kind === "invalid_state" ? result.message : "图片状态无效，请刷新后重试"
  };
}

function readableGeneratorError(error: unknown) {
  if (error instanceof ImageGeneratorError) return error.message;
  return "图片生成失败，请稍后重试";
}

async function persistImage(binary: Buffer, format: string, assetId: string, storageDir: string) {
  const extension = EXTENSION_BY_FORMAT[format.toLowerCase()] ?? "png";
  const directory = resolve(storageDir);
  await mkdir(directory, { recursive: true });
  // 文件名由服务端生成的 assetId 构成，绝不使用上游或用户提供的路径片段。
  const target = resolve(directory, `${assetId}.${extension}`);
  await writeFile(target, binary);
  return target;
}

/**
 * 生成一张真实配图：
 * beginGeneration（占位 generating，防并发重复点击）→ 调用生成服务 →
 * 成功落盘 + 写 publicUrl 置为 generated；失败置为 failed（占位图继续可用）。
 */
export async function generateImageAsset(
  input: { articleId: string; assetId: string; expectedUpdatedAt: string },
  dependencies: GenerateImageAssetDependencies
): Promise<GenerateImageAssetResult> {
  const begin = await dependencies.images.beginGeneration(
    input.articleId,
    input.assetId,
    input.expectedUpdatedAt
  );
  if (begin.kind !== "saved") return mapMutation(begin);
  const { article, assets } = begin;
  const asset = assets.find((candidate) => candidate.id === input.assetId);
  if (!asset) return { kind: "not_found" };

  try {
    const payload = await dependencies.generator.generate({
      prompt: asset.prompt,
      aspectRatio: asset.aspectRatio
    });

    let filePath: string | null = null;
    if (payload.binary) {
      filePath = await persistImage(
        payload.binary,
        payload.format,
        asset.id,
        dependencies.storageDir ?? resolve(process.cwd(), ".data", "generated-images")
      );
    }
    if (!payload.remoteUrl && !filePath) {
      throw new ImageGeneratorError("invalid_response", "图片生成服务返回了无效结果。");
    }

    const completed = await dependencies.images.completeGeneration(
      input.articleId,
      input.assetId,
      article.updatedAt,
      { publicUrl: payload.remoteUrl, filePath }
    );
    if (completed.kind !== "saved") return mapMutation(completed);
    return { kind: "saved", article: completed.article, assets: completed.assets };
  } catch (error) {
    const failed = await dependencies.images.failGeneration(
      input.articleId,
      input.assetId,
      article.updatedAt
    );
    if (failed.kind !== "saved") return mapMutation(failed);
    return { kind: "generator_error", message: readableGeneratorError(error) };
  }
}
