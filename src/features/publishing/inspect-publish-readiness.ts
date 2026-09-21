import type { Article, ContentBlock } from "@/features/articles/domain";
import { withStripsRestored } from "@/features/images/consumed-content";
import type { ImageAsset } from "@/features/images/domain";

/**
 * 纯段图流的发布就绪判定：推送门与公众号预览共用这一份事实源。
 *
 * 与 inspectSegmentStrips（拼接就绪）同构的是「读还原视图、只算不写」；
 * 不同的是它回答的是**发布层**的问题：
 * - 这篇文章走段图流还是旧混合流？——有 planning.storyboardSegments 就走段图流；
 * - 每个段是不是都已经有拼好的段图？——段图资产的 consumedContent 快照里
 *   带 segmentId（buildSegmentBlocks 给文案块打的标记），对账即可，不猜锚点；
 * - 有没有「不属于任何段」的残留块（作者手加的段落、导语、旧知识卡片）？
 *   默认推送会拒掉，作者确认（force）后保留为段图之间的图文；
 *   封面图块不算残留——它是草稿头图，段图流正文里本来就不渲染它；
 * - 摘要建议：纯段图正文没有文字可让微信抓取，digest 必须显式生成——
 *   取第一段成稿文案的开头。
 *
 * 客户端安全：只依赖 articles/domain、images 的 consumed-content / domain，
 * 不碰 node:crypto / node:fs，预览组件可以直接用。
 */

export interface MissingStripSegment {
  id: string;
  title: string;
}

/** 不属于任何分镜段的残留块；图片块的 content 用 altText 代偿，便于直接进警告文案。 */
export interface ResidualPublishBlock {
  id: string;
  type: ContentBlock["type"];
  content: string;
}

export interface PublishReadiness {
  mode: "strip_flow" | "legacy";
  totalSegments: number;
  missingStrips: MissingStripSegment[];
  residualBlocks: ResidualPublishBlock[];
  /**
   * 纯文字段（text_only）的文案块 id：**尚未拼接**（或作者取消段图后）时，
   * 预览把这些块渲染成文字条带；拼接后块被消费进段图快照，清单自然为空。
   * 推送门不靠它放行——未拼接的 text_only 计入 missingStrips。
   */
  plainTextBlockIds: string[];
  /** 第一段成稿文案的开头（≤50 字，微信 digest 上限 120、过长的意义不大）。 */
  suggestedDigest: string;
}

function assetContentUrl(asset: ImageAsset): string {
  return `/api/image-assets/${asset.id}/content`;
}

export function inspectPublishReadiness(
  article: Article,
  assets: readonly ImageAsset[]
): PublishReadiness {
  const segments = [...(article.planning.storyboardSegments ?? [])].sort(
    (left, right) => left.order - right.order
  );
  if (!segments.length) {
    return {
      mode: "legacy",
      totalSegments: 0,
      missingStrips: [],
      residualBlocks: [],
      plainTextBlockIds: [],
      suggestedDigest: ""
    };
  }

  const strippedSegmentIds = new Set<string>();
  for (const asset of assets) {
    if (asset.type !== "comic_strip" || !asset.consumedContent) continue;
    for (const block of asset.consumedContent.blocks) {
      if (block.segmentId) strippedSegmentIds.add(block.segmentId);
    }
  }

  const copyBlockIds = new Set(segments.flatMap((segment) => segment.copyBlockIds));
  const stripUrls = new Set(
    assets
      .filter((asset) => asset.type === "comic_strip" && asset.status === "generated")
      .map(assetContentUrl)
  );
  // 封面是公众号草稿的**头图**，不属于正文序列：段图流的渲染本来就把它丢掉
  // （renderWechatStripFlowHtml 只认段图 URL）。所以它不能算「作者忘了处理的残留块」——
  // 算了的话，每一篇有封面的分镜文章推送时都要先勾一次「强制重新推送」。
  const coverUrls = new Set(
    assets.filter((asset) => asset.type === "cover").map(assetContentUrl)
  );
  // 注意：withStripsRestored 只还原文本块（restoreConsumedBlocks 会滤掉 image），
  // 所以残留文本块在还原视图上找，残留图片块必须在原始正文上找。
  const restored = withStripsRestored(article.blocks, assets);
  const residualText = restored.filter(
    (block) => block.type !== "image" && !copyBlockIds.has(block.id)
  );
  const residualImages = article.blocks.filter(
    (block) =>
      block.type === "image" &&
      !stripUrls.has(block.content) &&
      !coverUrls.has(block.content)
  );
  const residualBlocks = [...residualText, ...residualImages]
    .sort((left, right) => left.order - right.order)
    .map((block) => ({
      id: block.id,
      type: block.type,
      content:
        block.type === "image" ? block.altText || "未命名配图" : block.content.trim()
    }));

  // 纯文字段（text_only）拼接后同样产出一张段图（纯文字图），文案块被吃进快照，
  // 所以没拼时它计入 missingStrips（推送门拦下、引导作者先拼接）。
  // plainTextBlockIds 仍保留：取消段图（文案回到正文）或尚未拼接时，
  // 预览把这些块渲染成文字条带，所见即所推的「推」由 missingStrips 把关。
  const plainTextBlockIds = new Set<string>();
  for (const segment of segments) {
    if (segment.route !== "text_only") continue;
    for (const blockId of segment.copyBlockIds) plainTextBlockIds.add(blockId);
  }

  const missingStrips = segments
    .filter((segment) => !strippedSegmentIds.has(segment.id))
    .map((segment) => ({ id: segment.id, title: segment.title }));

  const firstSegment = segments[0] as (typeof segments)[number];
  const digestSource = restored
    .filter(
      (block) =>
        firstSegment.copyBlockIds.includes(block.id) && block.type !== "heading"
    )
    .sort((left, right) => left.order - right.order)
    .map((block) => block.content.trim())
    .join("");
  const suggestedDigest = digestSource.replace(/\s+/g, "").slice(0, 50);

  return {
    mode: "strip_flow",
    totalSegments: segments.length,
    missingStrips,
    residualBlocks,
    plainTextBlockIds: [...plainTextBlockIds],
    suggestedDigest
  };
}
