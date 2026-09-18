import type { ContentBlock } from "@/features/articles/domain";
import type { ConsumedContent, ImageAsset } from "./domain";

/**
 * 长图替换掉的正文如何「还原」，以及「临时还原一份」。
 *
 * 单独成一个模块是因为它**必须能在客户端跑**：`merge-image-blocks.ts` 引入了 `node:crypto`，
 * 客户端组件一旦 import 它整条浏览器构建就挂。而界面恰恰需要这套还原逻辑——
 * 拼过长图之后正文里只剩那张长图，不先在虚拟视图上还原，界面就会以为「没有分镜」，
 * 把「按新模式重拼」按钮一直置灰。服务端和界面共用这一份实现，避免两边判得不一样。
 */

/**
 * 把长图当初替换掉的文字块放回正文序列。
 *
 * 这是 `mergeImageBlocks` 的反向操作：那边把块「藏」进长图里，这边把快照原样放回。
 * 只放文字块——图片块本来就由 `mergeImageBlocks` 在落库时重新插回，
 * 在这里也塞一遍只会插出两份。
 *
 * 位置靠 `resumeBeforeBlockId` 定位而不是靠 order：正文每次落库都会重排 order，
 * 快照里那些序号早就对不上了，只有「插在哪一块之前」这个相对位置还成立。
 *
 * 还原前要先过一道「这批快照是不是上一代留下的」判定：正文被整篇重新生成/换设计之后，
 * 老段图（老长图）的快照还挂在资产上，把它的文案放回新正文，作者就会看到「图里一遍、
 * 文字又一遍」，而且新段图随后按新块 id 去认领时正文里已经没有那些块可藏。判据分两层：
 * - 快照块带段 id（分镜段图）→ 看段 id 在不在当前设计里，一个都不在就整批丢弃（见下）；
 * - 快照块没段 id（早年的文章级长图）→ 看锚点块还在不在正文里，找不到就是上一代正文。
 */
export function restoreConsumedBlocks(
  blocks: readonly ContentBlock[],
  consumed: ConsumedContent | null,
  activeSegmentIds: readonly string[] = []
): ContentBlock[] {
  if (!consumed?.blocks.length) return [...blocks];

  const byOrder = (left: ContentBlock, right: ContentBlock) => left.order - right.order;
  const textBlocks = blocks.filter((block) => block.type !== "image").sort(byOrder);
  const present = new Set(textBlocks.map((block) => block.id));
  const missing = consumed.blocks
    .filter((block) => block.type !== "image" && !present.has(block.id))
    .sort(byOrder);
  if (!missing.length) return [...blocks];

  const snapshotSegments = missing
    .map((block) => block.segmentId)
    .filter((segmentId): segmentId is string => Boolean(segmentId));
  // 带段 id 的快照只认「这批块属不属于当前这套分镜设计」：段 id 一个都对不上
  // = 上一代设计留下的快照，整批丢弃。设计还没进 planning 时不套这条（宁可照常还原）。
  if (snapshotSegments.length) {
    const active = new Set(activeSegmentIds);
    if (active.size && snapshotSegments.every((segmentId) => !active.has(segmentId))) {
      return [...blocks];
    }
  }

  const at = consumed.resumeBeforeBlockId
    ? textBlocks.findIndex((block) => block.id === consumed.resumeBeforeBlockId)
    : -1;
  // 没有段 id 的老式快照（文章级长图）只能看锚点：锚点块在正文里彻底找不到
  // = 这是上一代正文的快照，不还原。
  // 带段 id 的快照不受这条限制：锚点可能因为历史脏数据早就丢了，图仍然属于当前设计，
  // 不还原反倒会把「块和图一起弄没」（恢复版本的两步串联正要靠它把块放回来）。
  if (!snapshotSegments.length && consumed.resumeBeforeBlockId && at < 0) return [...blocks];

  return at >= 0
    ? [...textBlocks.slice(0, at), ...missing, ...textBlocks.slice(at)]
    : [...textBlocks, ...missing];
}

/**
 * 把已经烘进长图、暂时不在正文里的那些块「临时」放回来，只为识别分镜用。
 *
 * 只算不写：正文要等旧长图真的撤掉才会变回原样。凡是要判断「这篇还能不能拼长图」的地方
 * （组装新长图前的校验、界面上的按钮可用态）都得先过这一层。
 */
export function withStripsRestored(
  blocks: ContentBlock[],
  assets: readonly ImageAsset[],
  activeSegmentIds: readonly string[] = []
): ContentBlock[] {
  return assets.reduce(
    (current, asset) =>
      asset.consumedContent
        ? restoreConsumedBlocks(current, asset.consumedContent, activeSegmentIds)
        : current,
    blocks
  );
}

/** 从 planning 的段设计里取段 id 列表：判断一份长图快照是否属于上一代设计。 */
export function storyboardSegmentIds(
  segments: readonly { id: string }[] | null | undefined
): string[] {
  return (segments ?? []).map((segment) => segment.id);
}
