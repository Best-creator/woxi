"use client";

import { useMemo } from "react";
import { BlockEditor } from "@/components/block-editor";
import {
  STORYBOARD_ROUTES,
  STORYBOARD_ROUTE_LABELS,
  storyboardFrameCount,
  type BlockType,
  type ContentBlock,
  type StoryboardRoute,
  type StoryboardSegment
} from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";

// 这里不引 merge-image-blocks 的 imageContentUrl：那个模块带 node:crypto，
// 进客户端组件会把浏览器构建打挂。路径形态与配图面板保持一致即可。
const contentUrl = (assetId: string) => `/api/image-assets/${assetId}/content`;

const frameStatusLabels: Record<ImageAsset["status"], string> = {
  planned: "待生成",
  placeholder: "待生成",
  generating: "生成中",
  generated: "已生成",
  disabled: "已停用",
  failed: "生成失败"
};

export interface StoryboardSegmentListProps {
  /** 设计稿的分镜段（按 order 升序展示）。 */
  segments: StoryboardSegment[];
  /**
   * 设计视图用的正文：必须传 `withStripsRestored` 的还原视图——
   * 拼过段图后 copyBlockIds 指向的块已从 article.blocks 消失，不还原就找不到文案。
   */
  blocks: ContentBlock[];
  imageAssets: ImageAsset[];
  /** 已拼接段图：卡内文案锁定（编辑会被合并逻辑静默吞掉），路由仍可改。 */
  stripsComposed: boolean;
  readOnly?: boolean;
  onEditBlocks: (blocks: ContentBlock[]) => void;
  onRouteChange: (segmentId: string, route: StoryboardRoute) => void;
}

interface SegmentCard {
  segment: StoryboardSegment;
  blocks: ContentBlock[];
  /** 本卡之前各卡累计的块类型数：喂给 BlockEditor 保证「标题块 N」全页唯一。 */
  typeCountSeed: Partial<Record<BlockType, number>>;
}

export function StoryboardSegmentList({
  segments,
  blocks,
  imageAssets,
  stripsComposed,
  readOnly = false,
  onEditBlocks,
  onRouteChange
}: StoryboardSegmentListProps) {
  const assetById = useMemo(
    () => new Map(imageAssets.map((asset) => [asset.id, asset])),
    [imageAssets]
  );

  const cards = useMemo<SegmentCard[]>(() => {
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const byOrder = (left: ContentBlock, right: ContentBlock) => left.order - right.order;
    const tally: Partial<Record<BlockType, number>> = {};
    return [...segments]
      .sort((left, right) => left.order - right.order)
      .map((segment) => {
        const cardBlocks = segment.copyBlockIds
          .map((id) => blockById.get(id))
          .filter((block): block is ContentBlock => Boolean(block))
          .sort(byOrder);
        const seed = { ...tally };
        for (const block of cardBlocks) {
          tally[block.type] = (tally[block.type] ?? 0) + 1;
        }
        return { segment, blocks: cardBlocks, typeCountSeed: seed };
      });
  }, [segments, blocks]);

  function editSegmentBlocks(cardBlocks: ContentBlock[], updated: ContentBlock[]) {
    // 卡内编辑器只拿到本段的块，合并回全量正文时按 id 覆盖、其余原样保留。
    // 文案可编辑时必然没有段图（此时 blocks 就是 article.blocks 本身），合并是精确的。
    const editedById = new Map(updated.map((block) => [block.id, block]));
    onEditBlocks(blocks.map((block) => editedById.get(block.id) ?? block));
  }

  return (
    <div className="storyboard-segment-list" aria-label="分镜设计">
      {cards.map(({ segment, blocks: cardBlocks, typeCountSeed }) => {
        const required = storyboardFrameCount(segment.route);
        const routeMismatch = segment.frameAssetIds.length !== required;
        const isTextOnly = segment.route === "text_only";
        return (
          <article
            className="storyboard-segment-card"
            data-segment-id={segment.id}
            key={segment.id}
          >
            <header className="storyboard-segment-head">
              <h3 className="storyboard-segment-title">{segment.title}</h3>
              <span aria-hidden="true" className="storyboard-segment-route-label">排法</span>
              <select
                aria-label={`${segment.title} 排法`}
                className="storyboard-segment-route"
                disabled={readOnly}
                value={segment.route}
                onChange={(event) => onRouteChange(segment.id, event.target.value as StoryboardRoute)}
              >
                {STORYBOARD_ROUTES.map((route) => (
                  <option key={route} value={route}>
                    {STORYBOARD_ROUTE_LABELS[route]}
                  </option>
                ))}
              </select>
            </header>

            {routeMismatch ? (
              <p className="storyboard-segment-warning" role="status">
                {isTextOnly
                  ? "纯文字段不配画面；切回其他排法可恢复这些帧的占位"
                  : `该排法需要 ${required} 帧，当前 ${segment.frameAssetIds.length} 帧`}
              </p>
            ) : null}

            {segment.frameAssetIds.length ? (
              <ul className="storyboard-segment-frames">
                {segment.frameAssetIds.map((assetId, index) => {
                  const asset = assetById.get(assetId);
                  const ready = asset?.status === "generated" && Boolean(asset.filePath);
                  return (
                    <li className="storyboard-segment-frame" key={assetId}>
                      {asset && ready ? (
                        // 内部 content 路由地址动态，next/image 不适用。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={contentUrl(assetId)} alt={asset.altText} loading="lazy" />
                      ) : (
                        <span className="storyboard-frame-placeholder">
                          {asset ? frameStatusLabels[asset.status] : "已删除"}
                        </span>
                      )}
                      <span className="storyboard-frame-caption">第 {index + 1} 帧</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="storyboard-segment-warning" role="status">
                {isTextOnly
                  ? "纯文字段：不配画面，文案作为普通正文段落排在段图之间"
                  : "这一段还没有分镜帧"}
              </p>
            )}

            {cardBlocks.length ? (
              <BlockEditor
                blocks={cardBlocks}
                initialTypeCounts={typeCountSeed}
                readOnly={readOnly}
                disabled={stripsComposed}
                onChange={(updated) => editSegmentBlocks(cardBlocks, updated)}
              />
            ) : (
              <p className="storyboard-segment-warning" role="status">
                这一段的成稿文案不在正文里，请重新生成正文设计分镜
              </p>
            )}

            {stripsComposed ? (
              <p className="storyboard-segment-lock" role="status">
                已拼接段图，先取消段图再修改文案
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
