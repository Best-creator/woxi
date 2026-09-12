import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseStyleProfileJson } from "@/features/content/style-profile";
import {
  DEFAULT_ARTICLE_PLANNING,
  type Article,
  type ArticlePlanning,
  type ArticleStatus,
  type ContentBlock,
  type KnowledgeBrief,
  type OutlineSection
} from "@/features/articles/domain";
import type { ImageAsset, ImageAssetStatus, ImagePlanSuggestion } from "./domain";
import { imageContentUrl, mergeImageBlocks } from "./merge-image-blocks";
import type {
  ImageAssetPatch,
  ImageAssetRepository,
  ImagePlanMutationResult
} from "./repository";

interface ArticleRow {
  id: string;
  title: string;
  topic: string;
  status: ArticleStatus;
  brief_json: string | null;
  outline_json: string;
  blocks_json: string;
  planning_json: string | null;
  style_json: string | null;
  outline_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImageAssetRow {
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
  manually_edited: number;
  position: number;
  created_at: string;
  updated_at: string;
}

class AbortMutation extends Error {
  constructor(readonly result: ImagePlanMutationResult) {
    super(result.kind);
  }
}

function parsePlanning(planningJson: string | null): ArticlePlanning {
  return planningJson
    ? (JSON.parse(planningJson) as ArticlePlanning)
    : { ...DEFAULT_ARTICLE_PLANNING };
}

function parseArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status,
    brief: row.brief_json ? (JSON.parse(row.brief_json) as KnowledgeBrief) : null,
    outline: JSON.parse(row.outline_json) as OutlineSection[],
    blocks: JSON.parse(row.blocks_json) as ContentBlock[],
    planning: parsePlanning(row.planning_json),
    styleProfile: parseStyleProfileJson(row.style_json),
    outlineConfirmedAt: row.outline_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseAsset(row: ImageAssetRow): ImageAsset {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

export class SqliteImageAssetRepository implements ImageAssetRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(articleId: string): Promise<ImageAsset[]> {
    return this.listSync(articleId);
  }

  async findById(articleId: string, assetId: string): Promise<ImageAsset | null> {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE article_id = ? AND id = ?")
      .get(articleId, assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  async findByAssetId(assetId: string): Promise<ImageAsset | null> {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE id = ?")
      .get(assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  async applyPlan(
    articleId: string,
    expectedUpdatedAt: string,
    suggestions: ImagePlanSuggestion[]
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (suggestions.length > 12) {
        return { kind: "invalid_plan", message: "图片计划最多支持 12 张图片" };
      }

      const anchors = new Set(
        article.blocks.filter((block) => block.type !== "image").map((block) => block.id)
      );
      for (const suggestion of suggestions) {
        if (suggestion.type === "cover" && suggestion.anchorBlockId !== null) {
          return { kind: "invalid_state", message: "封面不能关联正文锚点" };
        }
        if (suggestion.type !== "cover" && !anchors.has(suggestion.anchorBlockId ?? "")) {
          return { kind: "invalid_anchor", anchorBlockId: suggestion.anchorBlockId ?? "" };
        }
      }

      const existing = this.listSync(articleId);
      const disposable = existing.filter(
        (asset) =>
          !asset.manuallyEdited &&
          (asset.status === "planned" || asset.status === "placeholder")
      );
      for (const asset of disposable) {
        this.db.prepare("DELETE FROM image_assets WHERE id = ?").run(asset.id);
      }

      let assetTimestamp = article.updatedAt;
      let position = this.nextPosition(articleId);
      for (const suggestion of suggestions) {
        assetTimestamp = nextTimestamp(assetTimestamp);
        const id = randomUUID();
        const asset: ImageAsset = {
          id,
          articleId,
          ...suggestion,
          status: "placeholder",
          placeholderUrl: imageContentUrl(id),
          filePath: null,
          publicUrl: null,
          manuallyEdited: false,
          createdAt: assetTimestamp,
          updatedAt: assetTimestamp
        };
        this.insertAsset(asset, position);
        position += 1;
      }

      const assets = this.listSync(articleId);
      return this.saveAggregate(
        article,
        expectedUpdatedAt,
        assets,
        disposable.map((asset) => asset.id)
      );
    });
  }

  async update(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string,
    patch: ImageAssetPatch
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };

      const hasAnchorPatch = Object.hasOwn(patch, "anchorBlockId");
      const proposedAnchor =
        patch.anchorBlockId === undefined ? asset.anchorBlockId : patch.anchorBlockId;
      if (asset.type === "cover" && proposedAnchor !== null) {
        return { kind: "invalid_state", message: "封面不能关联正文锚点" };
      }
      if (asset.type !== "cover") {
        if (!proposedAnchor) {
          return { kind: "invalid_state", message: "正文插图必须关联正文锚点" };
        }
        const validAnchors = new Set(
          article.blocks.filter((block) => block.type !== "image").map((block) => block.id)
        );
        if (!validAnchors.has(proposedAnchor)) {
          return { kind: "invalid_anchor", anchorBlockId: proposedAnchor };
        }
      }

      const contentEdited =
        Object.hasOwn(patch, "prompt") ||
        Object.hasOwn(patch, "altText") ||
        hasAnchorPatch ||
        Object.hasOwn(patch, "aspectRatio");
      const status =
        patch.enabled === false
          ? "disabled"
          : patch.enabled === true && asset.status === "disabled"
            ? "placeholder"
            : asset.status;
      const updated: ImageAsset = {
        ...asset,
        anchorBlockId: proposedAnchor,
        prompt: patch.prompt ?? asset.prompt,
        altText: patch.altText ?? asset.altText,
        aspectRatio: patch.aspectRatio ?? asset.aspectRatio,
        status,
        manuallyEdited: contentEdited ? true : asset.manuallyEdited,
        updatedAt: nextTimestamp(asset.updatedAt)
      };
      this.updateAsset(updated);
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  async remove(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      if (!this.assetForArticle(articleId, assetId)) return { kind: "not_found" };

      this.db
        .prepare("DELETE FROM image_assets WHERE article_id = ? AND id = ?")
        .run(articleId, assetId);
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId), [assetId]);
    });
  }

  async refreshPlaceholder(
    articleId: string,
    assetId: string,
    expectedUpdatedAt: string
  ): Promise<ImagePlanMutationResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(articleId, expectedUpdatedAt);
      if (!article) return this.missingOrConflict(articleId, expectedUpdatedAt);
      const asset = this.assetForArticle(articleId, assetId);
      if (!asset) return { kind: "not_found" };
      if (asset.status === "disabled") {
        return { kind: "invalid_state", message: "禁用图片不能重建占位图" };
      }

      this.updateAsset({
        ...asset,
        status: "placeholder",
        updatedAt: nextTimestamp(asset.updatedAt)
      });
      return this.saveAggregate(article, expectedUpdatedAt, this.listSync(articleId));
    });
  }

  private inTransaction(work: () => ImagePlanMutationResult): ImagePlanMutationResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original database or mutation failure.
      }
      if (error instanceof AbortMutation) return error.result;
      throw error;
    }
  }

  private currentArticle(articleId: string, expectedUpdatedAt: string): Article | null {
    const row = this.db
      .prepare("SELECT * FROM articles WHERE id = ?")
      .get(articleId) as unknown as ArticleRow | undefined;
    if (!row) return null;
    const article = parseArticle(row);
    if (article.updatedAt !== expectedUpdatedAt) {
      throw new AbortMutation({ kind: "conflict" });
    }
    return article;
  }

  private missingOrConflict(articleId: string, expectedUpdatedAt: string): ImagePlanMutationResult {
    const row = this.db
      .prepare("SELECT updated_at FROM articles WHERE id = ?")
      .get(articleId) as unknown as { updated_at: string } | undefined;
    return row && row.updated_at !== expectedUpdatedAt
      ? { kind: "conflict" }
      : { kind: "not_found" };
  }

  private assetForArticle(articleId: string, assetId: string): ImageAsset | null {
    const row = this.db
      .prepare("SELECT * FROM image_assets WHERE article_id = ? AND id = ?")
      .get(articleId, assetId) as unknown as ImageAssetRow | undefined;
    return row ? parseAsset(row) : null;
  }

  private listSync(articleId: string): ImageAsset[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM image_assets WHERE article_id = ? ORDER BY position ASC"
      )
      .all(articleId) as unknown as ImageAssetRow[];
    return rows.map(parseAsset);
  }

  private nextPosition(articleId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM image_assets WHERE article_id = ?"
      )
      .get(articleId) as unknown as { next_position: number };
    return row.next_position;
  }

  private insertAsset(asset: ImageAsset, position: number) {
    this.db
      .prepare(`
        INSERT INTO image_assets (
          id, article_id, anchor_block_id, type, purpose, prompt, alt_text,
          aspect_ratio, status, placeholder_url, file_path, public_url,
          manually_edited, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        asset.id,
        asset.articleId,
        asset.anchorBlockId,
        asset.type,
        asset.purpose,
        asset.prompt,
        asset.altText,
        asset.aspectRatio,
        asset.status,
        asset.placeholderUrl,
        asset.filePath,
        asset.publicUrl,
        asset.manuallyEdited ? 1 : 0,
        position,
        asset.createdAt,
        asset.updatedAt
      );
  }

  private updateAsset(asset: ImageAsset) {
    this.db
      .prepare(`
        UPDATE image_assets
        SET anchor_block_id = ?, prompt = ?, alt_text = ?, aspect_ratio = ?,
            status = ?, placeholder_url = ?, manually_edited = ?, updated_at = ?
        WHERE id = ? AND article_id = ?
      `)
      .run(
        asset.anchorBlockId,
        asset.prompt,
        asset.altText,
        asset.aspectRatio,
        asset.status,
        asset.placeholderUrl,
        asset.manuallyEdited ? 1 : 0,
        asset.updatedAt,
        asset.id,
        asset.articleId
      );
  }

  private saveAggregate(
    article: Article,
    expectedUpdatedAt: string,
    assets: ImageAsset[],
    removedAssetIds: readonly string[] = []
  ): ImagePlanMutationResult {
    const updatedAt = nextTimestamp(article.updatedAt);
    const updatedArticle: Article = {
      ...article,
      blocks: mergeImageBlocks(article.blocks, assets, removedAssetIds),
      updatedAt
    };    const result = this.db
      .prepare(
        "UPDATE articles SET blocks_json = ?, updated_at = ? WHERE id = ? AND updated_at = ?"
      )
      .run(
        JSON.stringify(updatedArticle.blocks),
        updatedArticle.updatedAt,
        article.id,
        expectedUpdatedAt
      ) as unknown as { changes: number };
    if (result.changes === 0) {
      throw new AbortMutation({ kind: "conflict" });
    }
    return { kind: "saved", article: updatedArticle, assets };
  }
}
