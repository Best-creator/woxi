"use client";

import { useState } from "react";
import type { BlockType, ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";

export interface BlockEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  readOnly?: boolean;
  imageAssets?: ImageAsset[];
  highlightedBlockIds?: readonly string[];
  /**
   * 「标题块 N / 正文块 N」的编号种子：分镜设计视图把正文按段拆成多张卡片渲染，
   * 每张卡各有一个 BlockEditor，用上一张卡的累计数做种子才能保证块编号全页唯一。
   * 不传时从零起算，行为与旧的单编辑器完全一致。
   */
  initialTypeCounts?: Partial<Record<BlockType, number>>;
  /** 整体禁用（段图拼接后锁定文案）：比 readOnly 更强的「不可编辑」语义。 */
  disabled?: boolean;
}

const imageAspectRatios: Record<ImageAsset["aspectRatio"], number> = {
  cover: 900 / 383,
  landscape: 3 / 2,
  square: 1,
  portrait: 3 / 4
};

const blockNames: Record<ContentBlock["type"], string> = {
  heading: "标题",
  paragraph: "正文",
  quote: "引用",
  callout: "提示",
  knowledge_card: "知识卡片",
  image: "图片说明"
};

export function BlockEditor({
  blocks,
  onChange,
  readOnly = false,
  imageAssets = [],
  highlightedBlockIds = [],
  initialTypeCounts,
  disabled = false
}: BlockEditorProps) {
  const typeCounts = new Map<ContentBlock["type"], number>(
    Object.entries(initialTypeCounts ?? {}).map(([type, count]) => [
      type as ContentBlock["type"],
      count ?? 0
    ])
  );
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const highlighted = new Set(highlightedBlockIds);

  function updateBlock(id: string, content: string) {
    onChange(
      blocks.map((block) =>
        block.id === id
          ? { ...block, content, version: block.version + 1 }
          : block
      )
    );
  }

  return (
    <div className="block-editor" aria-label="文章内容">
      {blocks.map((block) => {
        const count = (typeCounts.get(block.type) ?? 0) + 1;
        typeCounts.set(block.type, count);
        const label = `${blockNames[block.type]}块 ${count}`;
        const isHighlighted = highlighted.has(block.id);

        if (block.type === "image") {
          const asset = imageAssets.find((candidate) => candidate.id === block.assetId);
          const failed = failedImageIds.has(block.id);
          // 段图（分段拼接产物）不能用「枚举宽高比 + object-fit: cover」这套渲染：
          // 真实段图约 1080×2308（比例 0.47），而最接近的 portrait 枚举是 0.75——
          // 框死再 cover 会把下半截裁掉，作者看到的是被放大的上半段，于是「图太大、
          // 字太大、看不全」。这里不设宽高比、contain 显示，并收到手机宽度：
          // 编辑器里看到的就是读者在公众号里滑到的那一屏。
          // 文案已经烘进段图里，不再叠图注（叠上去会糊在段图自带的文字卡上）。
          if (asset?.type === "comic_strip") {
            return (
              <figure
                className={
                  isHighlighted
                    ? "editor-image-block editor-image-block-strip is-highlighted"
                    : "editor-image-block editor-image-block-strip"
                }
                id={`block-${block.id}`}
                key={block.id}
              >
                {failed ? (
                  <div className="image-placeholder">图片位置</div>
                ) : (
                  // Internal placeholder routes need a stable, native image element.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={block.content}
                    alt={block.altText || "文章配图"}
                    loading="lazy"
                    onError={() => setFailedImageIds((current) => new Set(current).add(block.id))}
                  />
                )}
              </figure>
            );
          }
          const aspectRatio = asset ? imageAspectRatios[asset.aspectRatio] : imageAspectRatios.landscape;
          return (
            <figure
              className={isHighlighted ? "editor-image-block is-highlighted" : "editor-image-block"}
              id={`block-${block.id}`}
              key={block.id}
              style={{ aspectRatio }}
            >
              {failed ? (
                <div className="image-placeholder">图片位置</div>
              ) : (
                // Internal placeholder routes need a stable, native image element.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={block.content}
                  alt={block.altText || "文章配图"}
                  loading="lazy"
                  onError={() => setFailedImageIds((current) => new Set(current).add(block.id))}
                />
              )}
              <figcaption>{block.altText || block.content}</figcaption>
            </figure>
          );
        }

        return (
          <div
            className={`editor-block editor-block-${block.type}${isHighlighted ? " is-highlighted" : ""}`}
            id={`block-${block.id}`}
            key={block.id}
          >
            <span className="block-type-label">{blockNames[block.type]}</span>
            <textarea
              aria-label={label}
              className={`block-input block-input-${block.type}`}
              value={block.content}
              rows={block.type === "heading" ? 1 : Math.max(2, block.content.split("\n").length)}
              readOnly={readOnly || disabled}
              disabled={disabled}
              onChange={(event) => updateBlock(block.id, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
