import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ContentRevisionSnapshot } from "@/features/revisions/domain";

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
      ? { storyboardSegments: article.planning.storyboardSegments }
      : {})
  };
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
