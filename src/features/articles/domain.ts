import type { StyleProfile } from "@/features/content/style-profile";

export type ArticleStatus =
  | "draft"
  | "brief_ready"
  | "outline_ready"
  | "editing"
  | "content_ready"
  | "ready_to_publish";

export type LengthPreset = "short" | "standard" | "deep";

export const LENGTH_RANGES = {
  short: { min: 800, max: 1200 },
  standard: { min: 1000, max: 1500 },
  deep: { min: 1500, max: 2000 }
} as const;

export interface ArticlePlanning {
  lengthPreset: LengthPreset;
  recommendedTotalWords: number | null;
  confirmedOutlineRevisionId: string | null;
  contentOutlineRevisionId: string | null;
}

export const DEFAULT_ARTICLE_PLANNING: ArticlePlanning = {
  lengthPreset: "standard",
  recommendedTotalWords: null,
  confirmedOutlineRevisionId: null,
  contentOutlineRevisionId: null
};

export type BlockType =
  | "heading"
  | "paragraph"
  | "quote"
  | "callout"
  | "knowledge_card"
  | "image";

export interface ContentBlock {
  id: string;
  type: BlockType;
  content: string;
  order: number;
  level?: 1 | 2 | 3;
  altText?: string;
  assetId?: string;
  version: number;
}

export interface OutlineSection {
  id: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order: number;
}

export interface KnowledgeBrief {
  oneSentence: string;
  concepts: string[];
  prerequisites: string[];
  misconceptions: string[];
  analogies: string[];
  unsupportedNotes: string[];
}

export interface Article {
  id: string;
  title: string;
  topic: string;
  status: ArticleStatus;
  brief: KnowledgeBrief | null;
  outline: OutlineSection[];
  blocks: ContentBlock[];
  planning: ArticlePlanning;
  styleProfile: StyleProfile;
  outlineConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
