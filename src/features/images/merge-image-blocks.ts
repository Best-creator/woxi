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
 * 同槽位出现多版资产时的决胜规则：
 * 1. 作者手动编辑/选用过的资产是钦点版本，批量重规划不得顶替；
 * 2. 其余后产生的替换先产生的——重新规划/重新生成的意图是「换一张」，
 *    不是「新旧并排」（全部版本仍留在素材库供挑选）。
 * 判定用 createdAt（这一版何时产生，ISO 字符串同构时字典序即时间序），
 * 同刻回落 id 比较，保证纯函数输出确定。
 */
function slotWinner(candidate: ImageAsset, incumbent: ImageAsset): ImageAsset {
  if (candidate.manuallyEdited !== incumbent.manuallyEdited) {
    return candidate.manuallyEdited ? candidate : incumbent;
  }
  if (candidate.createdAt !== incumbent.createdAt) {
    return candidate.createdAt > incumbent.createdAt ? candidate : incumbent;
  }
  return candidate.id > incumbent.id ? candidate : incumbent;
}

/**
 * 同一锚点内去重：同类型（同一槽位）只留最新一版；
 * 不同类型是规划器有意为之的多图（概念图、对比图…），互不挤占，全部保留。
 * Map 按首次插入顺序迭代，因此各类型保持它们原本的相对摆放位置。
 */
function dedupeLatestByType(assetsAtAnchor: ImageAsset[]): ImageAsset[] {
  const winnerByType = new Map<string, ImageAsset>();
  for (const asset of assetsAtAnchor) {
    const incumbent = winnerByType.get(asset.type);
    if (!incumbent) {
      winnerByType.set(asset.type, asset);
    } else {
      winnerByType.set(asset.type, slotWinner(asset, incumbent));
    }
  }
  return [...winnerByType.values()];
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
 * （见 `ConsumedContent`），取消长图时由仓储把快照放回去。这里只负责「藏」；
 * 「放回」在 `consumed-content.ts`（那份能在客户端跑，界面判按钮可用态也要用）。
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

  const coverCandidates = activeAssets.filter(
    (asset) => asset.type === "cover" && asset.anchorBlockId === null
  );
  // 封面槽位只渲染一张：多版封面按决胜规则取一张，其余留在素材库里。
  const coverAsset = coverCandidates.reduce<ImageAsset | null>(
    (latest, candidate) =>
      latest === null ? candidate : slotWinner(candidate, latest),
    null
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
  // 同锚点同类型的多版帧只留最新一版，其余版本留在素材库。
  for (const [anchorId, assetsAtAnchor] of anchored) {
    anchored.set(anchorId, dedupeLatestByType(assetsAtAnchor));
  }

  const placed: ContentBlock[] = coverAsset ? [imageBlock(coverAsset)] : [];
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
