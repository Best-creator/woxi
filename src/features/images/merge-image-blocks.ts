import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@/features/articles/domain";
import type { ConsumedContent, ImageAsset } from "./domain";

export function imageContentUrl(assetId: string) {
  return `/api/image-assets/${assetId}/content`;
}

/**
 * 把长图当初替换掉的文字块放回正文序列。
 *
 * 这是 `mergeImageBlocks` 的反向操作：那边把块「藏」进长图里，这边把快照原样放回。
 * 只放文字块——图片块本来就由 `mergeImageBlocks` 在落库时重新插回，
 * 在这里也塞一遍只会插出两份。
 *
 * 位置靠 `resumeBeforeBlockId` 定位而不是靠 order：正文每次落库都会重排 order，
 * 快照里那些序号早就对不上了，只有「插在哪一块之前」这个相对位置还成立。
 */
export function restoreConsumedBlocks(
  blocks: readonly ContentBlock[],
  consumed: ConsumedContent | null
): ContentBlock[] {
  if (!consumed?.blocks.length) return [...blocks];

  const byOrder = (left: ContentBlock, right: ContentBlock) => left.order - right.order;
  const textBlocks = blocks.filter((block) => block.type !== "image").sort(byOrder);
  const present = new Set(textBlocks.map((block) => block.id));
  const missing = consumed.blocks
    .filter((block) => block.type !== "image" && !present.has(block.id))
    .sort(byOrder);
  if (!missing.length) return [...blocks];

  const at = consumed.resumeBeforeBlockId
    ? textBlocks.findIndex((block) => block.id === consumed.resumeBeforeBlockId)
    : -1;
  return at >= 0
    ? [...textBlocks.slice(0, at), ...missing, ...textBlocks.slice(at)]
    : [...textBlocks, ...missing];
}

function imageBlock(asset: ImageAsset): ContentBlock {
  return {
    id: randomUUID(),
    type: "image",
    // 真图生成后直接引用公网 CDN 链接：复制到公众号时图片可被外部访问；
    // 未生成时回落 content route（占位 SVG / 本地生成文件）。
    content: asset.publicUrl ?? imageContentUrl(asset.id),
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
 *
 * 长图（consumedContent 非空）走的是另一条路：它不是插在正文中间，
 * 而是把「分镜图 + 中间那些文案」整体替换成一张图——那些块从这里消失，
 * 只在第一个被替换的块的位置留下长图本身。
 *
 * 代价是被替换的块会真的从 blocks_json 里没了，所以长图资产必须自己带着原文快照
 * （见 `ConsumedContent`），取消长图时由仓储把快照放回去。这里只负责「藏」。
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

  const stripsAtAnchor = new Map<string, ImageAsset[]>();
  const consumedBlockIds = new Set<string>();
  for (const asset of activeAssets) {
    const consumed = asset.consumedContent;
    if (!consumed) continue;
    for (const block of consumed.blocks) consumedBlockIds.add(block.id);
    const anchor = asset.anchorBlockId ?? consumed.blocks[0]?.id;
    if (anchor) stripsAtAnchor.set(anchor, [...(stripsAtAnchor.get(anchor) ?? []), asset]);
  }

  const covers = activeAssets.filter(
    (asset) => asset.type === "cover" && asset.anchorBlockId === null
  );
  const anchorIds = new Set(
    contentBlocks
      .filter((block) => block.type !== "image" && !consumedBlockIds.has(block.id))
      .map((block) => block.id)
  );
  const anchored = new Map<string, ImageAsset[]>();

  for (const asset of activeAssets) {
    // 长图由「被替换的块」那条路径摆放，不能在这里再按锚点插一次。
    if (asset.consumedContent) continue;
    if (asset.type === "cover" || !asset.anchorBlockId || !anchorIds.has(asset.anchorBlockId)) {
      continue;
    }
    const assetsAtAnchor = anchored.get(asset.anchorBlockId) ?? [];
    assetsAtAnchor.push(asset);
    anchored.set(asset.anchorBlockId, assetsAtAnchor);
  }

  const placed: ContentBlock[] = covers.map(imageBlock);
  for (const block of contentBlocks) {
    for (const strip of stripsAtAnchor.get(block.id) ?? []) {
      placed.push(imageBlock(strip));
    }
    // 被长图替换掉的块不再单独出现：它们已经烘进那张图里了。
    if (consumedBlockIds.has(block.id)) continue;

    placed.push({ ...block });
    for (const asset of anchored.get(block.id) ?? []) {
      placed.push(imageBlock(asset));
    }
  }

  return placed.map((block, order) => ({ ...block, order }));
}

/** @deprecated 使用 `mergeImageBlocks`；保留别名只为兼容既有导入。 */
export const placeImageBlocks = mergeImageBlocks;
