import {
  storyboardFrameCount,
  type Article,
  type StoryboardRoute
} from "@/features/articles/domain";
import { withStripsRestored } from "./consumed-content";
import type { ImageAsset } from "./domain";
import { CONSUMABLE_BLOCK_TYPES } from "./plan-comic-strip";

/**
 * 分段拼接的就绪判定：拼接按钮的可用态、状态徽章、逐段清单共用这一份事实源。
 *
 * 与 composeSegmentStrips 的校验完全同构——都在 `withStripsRestored` 还原视图上
 * 判断（拼过段图后文案块已从 article.blocks 消失），保证「按钮亮着就一定能拼成」。
 * 本模块必须保持客户端安全：只依赖 consumed-content / plan-comic-strip / domain，
 * 不碰 node:crypto / node:fs（那些住在 merge-image-blocks 与 compose 编排里）。
 */
export interface SegmentStripStatus {
  segmentId: string;
  title: string;
  order: number;
  route: StoryboardRoute;
  /** 该段路由要求的帧数。 */
  requiredFrames: number;
  /** 其中已生成且落盘的帧数（按路由截取）。 */
  readyFrames: number;
  /** 成稿文案是否还在正文里（还原视图上判定）。 */
  hasCopy: boolean;
  /** 该段对应的段图资产 id；尚未拼接时为 null。 */
  stripAssetId: string | null;
}

export interface SegmentStripsInspection {
  totalSegments: number;
  /** 帧齐全且已生成、文案块也还在正文里的段数（text_only 无帧，文案在即就绪）。 */
  readySegments: number;
  /** 会真正拼成段图的段数：text_only 拼的是纯文字图，同样计入。 */
  composableSegments: number;
  /** 全部段还差的真实图片帧数：资产缺失、未生成、无落盘文件都算差。 */
  pendingFrames: number;
  /** 成稿文案块已不在正文里（被删或类型不可烘）的段数。 */
  missingCopySegments: number;
  /** 逐段明细：界面按段列出「帧齐没齐、文案在不在、拼过没有」。 */
  segments: SegmentStripStatus[];
}

/**
 * 段图资产归属哪个段：拼接时把被替换掉的文案块（带 segmentId）整份存进快照，
 * 从快照里取第一个带段 id 的块即得。旧版漫画长图没有段 id，返回 null。
 */
export function stripSegmentIdOf(asset: ImageAsset): string | null {
  if (asset.type !== "comic_strip") return null;
  return (
    asset.consumedContent?.blocks.find((block) => Boolean(block.segmentId))?.segmentId ?? null
  );
}

/** 完整判定：汇总（按钮可用态、状态徽章）+ 逐段明细（分段清单），一次算完。 */
export function inspectSegmentStrips(
  article: Article,
  assets: readonly ImageAsset[]
): SegmentStripsInspection {
  const segments = [...(article.planning.storyboardSegments ?? [])].sort(
    (left, right) => left.order - right.order
  );
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  // 还原视图只认「当前这套设计」的长图快照：上一代设计的快照还原回来只会把旧文案
  // 混进正文，界面据此报出的就绪度也是假的。
  const restored = withStripsRestored(
    article.blocks,
    assets,
    segments.map((segment) => segment.id)
  );
  const copyableBlockIds = new Set(
    restored
      .filter((block) => block.type !== "image" && CONSUMABLE_BLOCK_TYPES.has(block.type))
      .map((block) => block.id)
  );

  // 段图 → 段：一个段至多留一张现行段图（重拼会先撤旧的）。
  const stripBySegment = new Map<string, string>();
  for (const asset of assets) {
    const segmentId = stripSegmentIdOf(asset);
    if (segmentId) stripBySegment.set(segmentId, asset.id);
  }

  let readySegments = 0;
  let composableSegments = 0;
  let pendingFrames = 0;
  let missingCopySegments = 0;
  const details: SegmentStripStatus[] = [];

  for (const segment of segments) {
    // 四种路由都可拼接：text_only 段拼的是纯文字图（0 帧、只要文案还在正文）。
    composableSegments += 1;
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

    details.push({
      segmentId: segment.id,
      title: segment.title,
      order: segment.order,
      route: segment.route,
      requiredFrames: required,
      readyFrames,
      hasCopy,
      stripAssetId: stripBySegment.get(segment.id) ?? null
    });
  }

  return {
    totalSegments: segments.length,
    readySegments,
    composableSegments,
    pendingFrames,
    missingCopySegments,
    segments: details
  };
}
