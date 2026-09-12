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
}
