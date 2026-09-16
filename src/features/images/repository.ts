import type { Article } from "@/features/articles/domain";
import type {
  ComicStripMode,
  ConsumedContent,
  ImageAspectRatio,
  ImageAsset,
  ImageGeneration,
  ImageLibraryItem,
  ImagePlanSuggestion
} from "./domain";

export type ImagePlanMutationResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid_plan"; message: string }
  | { kind: "invalid_anchor"; anchorBlockId: string }
  | { kind: "invalid_state"; message: string };

/**
 * 版本选用/删除的结果。
 * `removedFilePath` 只在删除时有值：仓储不碰文件系统，把路径交回上层去清理磁盘。
 */
export type ImageGenerationMutationResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[]; removedFilePath: string | null }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid_state"; message: string };

export interface ImageAssetPatch {
  anchorBlockId?: string | null;
  prompt?: string;
  altText?: string;
  aspectRatio?: ImageAspectRatio;
  enabled?: boolean;
}

export interface CompleteGenerationInput {
  publicUrl: string | null;
  filePath: string | null;
  /** 版本 id 由编排层先生成：落盘文件名要用它，不能等落库时才拿到。 */
  generationId: string;
  model?: string;
}

/**
 * 落库一张漫画长图。
 *
 * 图已经在磁盘上了（拼图是 CPU 活，不能塞进事务里），这里只做三件事：
 * 记一条长图资产、记一条生成版本、把「被它替换掉的正文快照」写进资产，
 * 这样取消长图时原文还能原样回来。
 */
export interface SaveComicStripInput {
  assetId: string;
  generationId: string;
  mode: ComicStripMode;
  anchorBlockId: string;
  consumedContent: ConsumedContent;
  altText: string;
  purpose: string;
  filePath: string;
}

export interface ImageAssetRepository {
  list(articleId: string): Promise<ImageAsset[]>;
  findById(articleId: string, assetId: string): Promise<ImageAsset | null>;
  findByAssetId(assetId: string): Promise<ImageAsset | null>;
  /** 文章素材库：本文全部生成版本，带所属配图的类型与用途，供跨槽位复用。 */
  listGenerations(articleId: string): Promise<ImageLibraryItem[]>;
  /** 单张配图的生成版本，按时间倒序（最新在前）。 */
  listGenerationsForAsset(articleId: string, assetId: string): Promise<ImageGeneration[]>;
  findGenerationById(generationId: string): Promise<ImageGeneration | null>;
  applyPlan(
    articleId: string,
    expectedUpdatedAt: string,
    suggestions: ImagePlanSuggestion[]
  ): Promise<ImagePlanMutationResult>;
  update(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    patch: ImageAssetPatch
  ): Promise<ImagePlanMutationResult>;
  remove(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult>;
  refreshPlaceholder(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult>;
  /** 生成前置位：校验状态后置为 generating 并推进文章 updatedAt。 */
  beginGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult>;
  /**
   * 生成成功落库：新增一条版本记录并置为「使用中」，
   * 同时把 filePath/publicUrl 镜像到配图资产上（下游消费者只看资产，不感知版本）。
   */
  completeGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    result: CompleteGenerationInput
  ): Promise<ImagePlanMutationResult>;
  /** 生成失败落库：置为 failed，占位图继续可用。 */
  failGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult>;
  /**
   * 选用某一版：切换 selected 标记并把该版镜像到配图资产上。
   *
   * 也接受本文其他配图的版本——那等于把这一版「挪」到本槽位（原槽位自动回落），
   * 而不是两处共享同一张图：一图一主人，删除时才不会牵连到别人。
   */
  selectGeneration(
    articleId: string,
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult>;
  /**
   * 删除某一版。删掉的若是当前版本，自动回落到剩下的最新一版；
   * 一版都不剩时配图退回「待生成」，占位图重新接管。
   */
  deleteGeneration(
    articleId: string,
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult>;
  /**
   * 落库一张漫画长图。被它替换掉的正文块随之从正文里隐去；
   * 只新增不覆盖，替换旧长图由编排层先调用 removeComicStrip。
   */
  saveComicStrip(
    articleId: string,
    expectedUpdatedAt: string,
    input: SaveComicStripInput
  ): Promise<ImagePlanMutationResult>;
  /**
   * 取消长图：删掉资产、清掉磁盘文件，并把当初替换掉的正文原样放回去。
   * 原文一直是随身带着的快照，所以这里能完整还原，不依赖任何版本历史。
   */
  removeComicStrip(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImageGenerationMutationResult>;
}

