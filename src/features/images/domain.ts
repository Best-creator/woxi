export type ImageAssetType =
  | "cover"
  | "concept"
  | "process"
  | "comparison"
  | "knowledge_card";

export type ImageAssetStatus =
  | "planned"
  | "placeholder"
  | "generating"
  | "generated"
  | "disabled"
  | "failed";

export type ImageAspectRatio = "cover" | "landscape" | "square" | "portrait";

export interface ImagePlanSuggestion {
  type: ImageAssetType;
  anchorBlockId: string | null;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImageAspectRatio;
}

export interface ImageAsset extends ImagePlanSuggestion {
  id: string;
  articleId: string;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
  createdAt: string;
  updatedAt: string;
}
