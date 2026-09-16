import type { ContentBlock } from "@/features/articles/domain";
import type { ConsumedContent, ImageAsset, ImageAssetStatus } from "./domain";

/**
 * image_assets 表的一行。
 *
 * 之所以单独放一个文件：配图仓储和正文工作流仓储都要读这张表，
 * 早先两份解析各写一遍，加字段时很容易只改一处——另一处读出来就是空的，
 * 而且不报错、只是行为悄悄退化。解析只留这一份。
 */
export interface ImageAssetRow {
  id: string;
  article_id: string;
  anchor_block_id: string | null;
  type: ImageAsset["type"];
  purpose: string;
  prompt: string;
  alt_text: string;
  aspect_ratio: ImageAsset["aspectRatio"];
  status: ImageAssetStatus;
  placeholder_url: string | null;
  file_path: string | null;
  public_url: string | null;
  consumed_blocks: string | null;
  manually_edited: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function parseConsumedContent(value: string | null): ConsumedContent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ConsumedContent>;
    if (!Array.isArray(parsed.blocks) || !parsed.blocks.length) return null;
    return {
      blocks: parsed.blocks as ContentBlock[],
      resumeBeforeBlockId:
        typeof parsed.resumeBeforeBlockId === "string" ? parsed.resumeBeforeBlockId : null
    };
  } catch {
    // 列里存的是自己写进去的 JSON，坏掉只可能是手工改库。按「没有替换过正文」处理，
    // 这张图就当普通配图用——总好过让整篇文章读不出来。
    return null;
  }
}

export function parseImageAssetRow(row: ImageAssetRow): ImageAsset {
  return {
    id: row.id,
    articleId: row.article_id,
    anchorBlockId: row.anchor_block_id,
    type: row.type,
    purpose: row.purpose,
    prompt: row.prompt,
    altText: row.alt_text,
    aspectRatio: row.aspect_ratio,
    status: row.status,
    placeholderUrl: row.placeholder_url,
    filePath: row.file_path,
    publicUrl: row.public_url,
    manuallyEdited: row.manually_edited === 1,
    consumedContent: parseConsumedContent(row.consumed_blocks),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
