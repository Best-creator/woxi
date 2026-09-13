"use client";

import { ImagePlus } from "lucide-react";
import { ImagePlanningPanel, type ImageMutationPayload, type ImagePlanGuideOptions } from "./image-planning-panel";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";

/**
 * 配图步骤的生成面板。
 *
 * 正文生成已完全归第 3 步的 `ContentWorkspace`，这里只保留配图规划，
 * 避免出现两个正文生成入口。
 */
export interface GenerationPanelProps {
  article: Article;
  imageAssets: ImageAsset[];
  readOnly?: boolean;
  imageOperationsLocked?: boolean;
  onImageResult: (result: ImageMutationPayload) => void;
  planImages: (expectedUpdatedAt: string, model?: string, options?: ImagePlanGuideOptions) => Promise<ImageMutationPayload>;
  updateImageAsset: (assetId: string, input: ImageAssetPatch & { expectedUpdatedAt: string }) => Promise<ImageMutationPayload>;
  deleteImageAsset: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  refreshPlaceholder: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  generateImage?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  /** 配图规划的模型选择（默认走服务端 LLM_VISUAL_MODEL）。 */
  llmEnabled?: boolean;
  availableModels?: string[];
}

export function GenerationPanel({
  article,
  imageAssets,
  readOnly,
  imageOperationsLocked,
  onImageResult,
  planImages,
  updateImageAsset,
  deleteImageAsset,
  refreshPlaceholder,
  generateImage,
  llmEnabled = false,
  availableModels = []
}: GenerationPanelProps) {
  return (
    <section className="generation-panel generation-panel-images" aria-label="配图规划">
      <div className="generation-panel-heading">
        <div><p className="panel-label">配图</p><h2>规划配图</h2></div>
        <ImagePlus size={18} aria-hidden="true" />
      </div>
      <ImagePlanningPanel
        article={article}
        assets={imageAssets}
        readOnly={readOnly}
        locked={imageOperationsLocked}
        onResult={(nextArticle, assets) => onImageResult({ article: nextArticle, assets })}
        planImages={planImages}
        updateAsset={updateImageAsset}
        deleteAsset={deleteImageAsset}
        refreshPlaceholder={refreshPlaceholder}
        generateImage={generateImage}
        llmEnabled={llmEnabled}
        availableModels={availableModels}
      />
    </section>
  );
}
