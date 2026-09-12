"use client";

import { useState } from "react";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";

export interface BlockEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  readOnly?: boolean;
  imageAssets?: ImageAsset[];
  highlightedBlockIds?: readonly string[];
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
  highlightedBlockIds = []
}: BlockEditorProps) {
  const typeCounts = new Map<ContentBlock["type"], number>();
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
          const aspectRatio = asset ? imageAspectRatios[asset.aspectRatio] : imageAspectRatios.landscape;
          const failed = failedImageIds.has(block.id);
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
              readOnly={readOnly}
              onChange={(event) => updateBlock(block.id, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
