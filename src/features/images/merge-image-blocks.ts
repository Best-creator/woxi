import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";

export function imageContentUrl(assetId: string) {
  return `/api/image-assets/${assetId}/content`;
}

function imageBlock(asset: ImageAsset): ContentBlock {
  return {
    id: randomUUID(),
    type: "image",
    content: imageContentUrl(asset.id),
    altText: asset.altText,
    assetId: asset.id,
    order: 0,
    version: 1
  };
}

/**
 * 按锚点把图片资产重新插回正文块序列，并重排 order。
 *
 * 这是纯函数：图片规划、图片状态变化和正文恢复共用同一套摆放规则，
 * 保证正文审核的内容哈希不受配图影响。
 */
export function mergeImageBlocks(
  blocks: ContentBlock[],
  assets: ImageAsset[],
  removedAssetIds: readonly string[] = []
): ContentBlock[] {
  const managedAssetIds = new Set([
    ...assets.map((asset) => asset.id),
    ...removedAssetIds
  ]);
  const contentBlocks = blocks.filter(
    (block) =>
      block.type !== "image" ||
      !block.assetId ||
      !managedAssetIds.has(block.assetId)
  );
  const activeAssets = assets.filter((asset) => asset.status !== "disabled");
  const covers = activeAssets.filter(
    (asset) => asset.type === "cover" && asset.anchorBlockId === null
  );
  const anchorIds = new Set(
    contentBlocks.filter((block) => block.type !== "image").map((block) => block.id)
  );
  const anchored = new Map<string, ImageAsset[]>();

  for (const asset of activeAssets) {
    if (asset.type === "cover" || !asset.anchorBlockId || !anchorIds.has(asset.anchorBlockId)) {
      continue;
    }
    const assetsAtAnchor = anchored.get(asset.anchorBlockId) ?? [];
    assetsAtAnchor.push(asset);
    anchored.set(asset.anchorBlockId, assetsAtAnchor);
  }

  const placed: ContentBlock[] = covers.map(imageBlock);
  for (const block of contentBlocks) {
    placed.push({ ...block });
    for (const asset of anchored.get(block.id) ?? []) {
      placed.push(imageBlock(asset));
    }
  }

  return placed.map((block, order) => ({ ...block, order }));
}

/** @deprecated 使用 `mergeImageBlocks`；保留别名只为兼容既有导入。 */
export const placeImageBlocks = mergeImageBlocks;
