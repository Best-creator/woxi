import type { Article } from "@/features/articles/domain";
import type {
  ImageAspectRatio,
  ImageAsset,
  ImagePlanSuggestion
} from "./domain";

export type ImagePlanMutationResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid_plan"; message: string }
  | { kind: "invalid_anchor"; anchorBlockId: string }
  | { kind: "invalid_state"; message: string };

export interface ImageAssetPatch {
  anchorBlockId?: string | null;
  prompt?: string;
  altText?: string;
  aspectRatio?: ImageAspectRatio;
  enabled?: boolean;
}

export interface ImageAssetRepository {
  list(articleId: string): Promise<ImageAsset[]>;
  findById(articleId: string, assetId: string): Promise<ImageAsset | null>;
  findByAssetId(assetId: string): Promise<ImageAsset | null>;
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
  /** 生成成功落库：写入 publicUrl/filePath 并置为 generated。 */
  completeGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    result: { publicUrl: string | null; filePath: string | null }
  ): Promise<ImagePlanMutationResult>;
  /** 生成失败落库：置为 failed，占位图继续可用。 */
  failGeneration(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult>;
}
