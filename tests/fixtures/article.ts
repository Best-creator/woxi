import type { Article, ContentBlock } from "@/features/articles/domain";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "@/features/content/style-profile";

export function paragraphBlock(content = "第一段正文"): ContentBlock {
  return {
    id: "block-paragraph-1",
    type: "paragraph",
    content,
    order: 0,
    version: 1
  };
}

export function knowledgeCardBlock(): ContentBlock {
  return {
    id: "block-card-1",
    type: "knowledge_card",
    content: "核心关系\n选择当前方案，就会放弃最佳替代方案。",
    order: 0,
    version: 1
  };
}

export function imageBlock(assetId = "asset-1"): ContentBlock {
  return {
    id: "block-image-1",
    type: "image",
    content: `/api/image-assets/${assetId}/content`,
    altText: "示例配图",
    assetId,
    order: 0,
    version: 1
  };
}

export function twoBlocks(): ContentBlock[] {
  return [
    paragraphBlock(),
    {
      id: "block-paragraph-2",
      type: "paragraph",
      content: "第二段正文",
      order: 1,
      version: 1
    }
  ];
}

export function articleFixture(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    title: "什么是机会成本",
    topic: "什么是机会成本",
    status: "draft",
    brief: null,
    outline: [],
    blocks: [],
    planning: {
      lengthPreset: "standard",
      recommendedTotalWords: null,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    },
    styleProfile: { ...DEFAULT_STYLE_PROFILE } as StyleProfile,
    outlineConfirmedAt: null,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  };
}
