import {
  storyboardFrameCount,
  type Article
} from "@/features/articles/domain";
import { withStripsRestored } from "./consumed-content";
import type { ImageAsset } from "./domain";
import { CONSUMABLE_BLOCK_TYPES } from "./plan-comic-strip";

/**
 * 分段拼接的就绪判定：第三步段卡警告与第四步拼接按钮可用态共用这一份事实源。
 *
 * 与 composeSegmentStrips 的校验完全同构——都在 `withStripsRestored` 还原视图上
 * 判断（拼过段图后文案块已从 article.blocks 消失），保证「按钮亮着就一定能拼成」。
 * 本模块必须保持客户端安全：只依赖 consumed-content / plan-comic-strip / domain，
 * 不碰 node:crypto / node:fs（那些住在 merge-image-blocks 与 compose 编排里）。
 */
export interface SegmentStripsReadiness {
  totalSegments: number;
  /** 帧齐全且已生成、文案块也还在正文里的段数。 */
  readySegments: number;
  /** 全部段还差的真实图片帧数：资产缺失、未生成、无落盘文件都算差。 */
  pendingFrames: number;
  /** 成稿文案块已不在正文里（被删或类型不可烘）的段数。 */
  missingCopySegments: number;
}

export function inspectSegmentStrips(
  article: Article,
  assets: readonly ImageAsset[]
): SegmentStripsReadiness {
  const segments = [...(article.planning.storyboardSegments ?? [])].sort(
    (left, right) => left.order - right.order
  );
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const restored = withStripsRestored(article.blocks, assets);
  const copyableBlockIds = new Set(
    restored
      .filter((block) => block.type !== "image" && CONSUMABLE_BLOCK_TYPES.has(block.type))
      .map((block) => block.id)
  );

  let readySegments = 0;
  let pendingFrames = 0;
  let missingCopySegments = 0;
  for (const segment of segments) {
    const required = storyboardFrameCount(segment.route);
    // 帧数按路由要求截取：设计帧不足时（比如改成图+文+图但只设计了 1 帧）同样记差，
    // 否则按钮会放行一场 binaries[1] 不存在的拼接。
    const readyFrames = segment.frameAssetIds
      .slice(0, required)
      .filter((id) => {
        const asset = assetById.get(id);
        return Boolean(asset && asset.status === "generated" && asset.filePath);
      }).length;
    pendingFrames += required - readyFrames;

    const hasCopy = segment.copyBlockIds.some((id) => copyableBlockIds.has(id));
    if (!hasCopy) missingCopySegments += 1;
    if (required - readyFrames === 0 && hasCopy) readySegments += 1;
  }

  return { totalSegments: segments.length, readySegments, pendingFrames, missingCopySegments };
}
