import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import type {
  ContentRevisionSnapshot,
  StoryboardFrameSnapshot,
  StoryboardSnapshotSegment
} from "@/features/revisions/domain";

export class ContentSnapshotError extends Error {
  constructor(message = "正文尚未基于已确认的大纲生成") {
    super(message);
    this.name = "ContentSnapshotError";
  }
}

/** 正文只保存文字块；图片由图片资产独立管理，不参与正文内容哈希。 */
export function textBlocksOf(blocks: readonly ContentBlock[]): ContentBlock[] {
  return blocks
    .filter((block) => block.type !== "image")
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((block, order) => ({ ...block, order }));
}

export function isContentBasedOnCurrentOutline(article: Article): boolean {
  return Boolean(
    article.planning.confirmedOutlineRevisionId &&
    article.planning.contentOutlineRevisionId === article.planning.confirmedOutlineRevisionId
  );
}

/**
 * 正文内容哈希只看标题、非图片正文块、人物风格和依赖的大纲修订 ID。
 * 配图状态、推荐字数或资料快照变化都不应制造新的正文版本。
 */
export function contentHashInput(snapshot: ContentRevisionSnapshot) {
  return {
    title: snapshot.title,
    textBlocks: snapshot.textBlocks,
    outlineRevisionId: snapshot.outlineRevisionId,
    styleProfile: snapshot.styleProfile
  };
}

export function createContentSnapshot(
  article: Article,
  sourceContextSnapshot: string
): ContentRevisionSnapshot {
  const outlineRevisionId = article.planning.contentOutlineRevisionId;
  const recommendedTotalWords = article.planning.recommendedTotalWords;
  const textBlocks = textBlocksOf(article.blocks);
  if (!outlineRevisionId || recommendedTotalWords === null || textBlocks.length === 0) {
    throw new ContentSnapshotError();
  }
  return {
    title: article.title,
    textBlocks,
    outlineRevisionId,
    styleProfile: article.styleProfile,
    recommendedTotalWords,
    sourceContextSnapshot,
    ...(article.planning.storyboardSegments?.length
      ? {
          // 这里拿不到资产列表，帧描述符先留空，由仓储层在落库前
          // 用 enrichStoryboardSnapshotSegments 补齐（恢复旧版本要靠描述符重建帧）。
          storyboardSegments: article.planning.storyboardSegments.map((segment) => ({
            ...segment,
            frames: []
          }))
        }
      : {})
  };
}

/**
 * 把快照里缺帧描述符的段补齐：按 frameAssetIds 从资产列表取 prompt/altText/aspectRatio。
 * 已带描述符的段（生成/修订编排直接传入的设计计划）原样保留；资产缺失的段描述符留空，
 * 恢复时该段只能落到「帧缺失」的降级态。
 */
export function enrichStoryboardSnapshotSegments(
  segments: StoryboardSnapshotSegment[],
  assets: readonly ImageAsset[]
): StoryboardSnapshotSegment[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  return segments.map((segment) => {
    if (segment.frames.length || !segment.frameAssetIds?.length) return segment;
    const frames: StoryboardFrameSnapshot[] = [];
    for (const id of segment.frameAssetIds) {
      const asset = assetById.get(id);
      // 任一帧资产缺失就整段放弃补齐：恢复时该段落到「帧缺失」降级态。
      if (!asset) return segment;
      frames.push({
        prompt: asset.prompt,
        altText: asset.altText,
        aspectRatio: asset.aspectRatio
      });
    }
    return { ...segment, frames };
  });
}

export function tryCreateContentSnapshot(
  article: Article,
  sourceContextSnapshot: string
): ContentRevisionSnapshot | null {
  try {
    return createContentSnapshot(article, sourceContextSnapshot);
  } catch {
    return null;
  }
}
