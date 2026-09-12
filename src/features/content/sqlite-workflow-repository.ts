import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_ARTICLE_PLANNING,
  type Article,
  type ArticlePlanning,
  type ArticleStatus,
  type ContentBlock,
  type KnowledgeBrief,
  type OutlineSection
} from "@/features/articles/domain";
import { hashSnapshot } from "@/features/revisions/content-hash";
import type {
  ArticleReview,
  ArticleRevision,
  ContentRevisionSnapshot,
  RevisionReason,
  RevisionScope
} from "@/features/revisions/domain";
import {
  createRevisionIfChangedInTransaction,
  parseRevisionRow
} from "@/features/revisions/sqlite-store";
import { mergeImageBlocks } from "@/features/images/merge-image-blocks";
import type { ImageAsset } from "@/features/images/domain";
import { contentHashInput, textBlocksOf } from "./content-version";
import { parseStyleProfileJson } from "./style-profile";
import type { ContentReviewResult } from "./ports";
import type {
  ContentWorkflowRepository,
  ContentWorkflowWriteResult,
  SaveGeneratedContentInput
} from "./workflow-repository";

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

interface RevisionRow {
  id: string;
  article_id: string;
  scope: RevisionScope;
  version_number: number;
  content_hash: string;
  snapshot_json: string;
  model: string | null;
  reason: RevisionReason;
  created_at: string;
}

interface ReviewRow {
  id: string;
  revision_id: string;
  model: string;
  result_json: string;
  created_at: string;
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
  status: ImageAsset["status"];
  placeholder_url: string | null;
  file_path: string | null;
  public_url: string | null;
  manually_edited: number;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  title: string;
  content: string;
  status: string;
  enabled: number;
}

class AbortMutation extends Error {
  constructor(readonly result: { kind: "conflict" }) {
    super(result.kind);
  }
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

function parsePlanning(value: string | null): ArticlePlanning {
  return value ? (JSON.parse(value) as ArticlePlanning) : { ...DEFAULT_ARTICLE_PLANNING };
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

function parseReview(row: ReviewRow): ArticleReview<ContentReviewResult> {
  return {
    id: row.id,
    revisionId: row.revision_id,
    model: row.model,
    result: JSON.parse(row.result_json) as ContentReviewResult,
    createdAt: row.created_at
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

/** 正文文章与不可变正文修订的唯一聚合写入方。 */
export class SqliteContentWorkflowRepository implements ContentWorkflowRepository {
  constructor(private readonly db: DatabaseSync) {}

  async saveGeneratedContent(input: SaveGeneratedContentInput): Promise<ContentWorkflowWriteResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const outlineRevisionId = article.planning.confirmedOutlineRevisionId;
      if (!outlineRevisionId) throw new AbortMutation({ kind: "conflict" });
      const textBlocks = textBlocksOf(input.textBlocks);
      const snapshot: ContentRevisionSnapshot = {
        title: input.title,
        textBlocks,
        outlineRevisionId,
        styleProfile: input.styleProfile,
        recommendedTotalWords: article.planning.recommendedTotalWords ?? textBlocks.length,
        sourceContextSnapshot: input.sourceContextSnapshot
      };
      const revision = this.createRevision(input.articleId, snapshot, input.model, "generated");
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        title: input.title,
        blocks: mergeImageBlocks(textBlocks, this.listImageAssets(article.id)),
        status: "editing",
        styleProfile: input.styleProfile,
        planning: {
          ...article.planning,
          contentOutlineRevisionId: outlineRevisionId
        }
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "saved", article: updated, revision };
    });
  }

  async checkpointContent(input: {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
    snapshot: ContentRevisionSnapshot;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      return {
        kind: "checkpointed" as const,
        revision: this.createRevision(input.articleId, input.snapshot, input.model, "review_checkpoint")
      };
    });
  }

  async saveContentReview(input: {
    revisionId: string;
    model: string;
    result: ContentReviewResult;
  }): Promise<ArticleReview<ContentReviewResult>> {
    return this.inTransaction(() => {
      const previous = this.db.prepare(
        `SELECT created_at FROM article_reviews
         WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get(input.revisionId) as unknown as { created_at: string } | undefined;
      const review: ArticleReview<ContentReviewResult> = {
        id: randomUUID(),
        revisionId: input.revisionId,
        model: input.model,
        result: input.result,
        createdAt: nextTimestamp(previous?.created_at)
      };
      this.db.prepare(
        `INSERT INTO article_reviews (id, revision_id, model, result_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(review.id, review.revisionId, review.model, JSON.stringify(review.result), review.createdAt);
      return review;
    });
  }

  async findCurrentContentReview(input: {
    articleId: string;
    snapshot: ContentRevisionSnapshot;
  }) {
    const row = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'content' AND content_hash = ?
       ORDER BY version_number DESC LIMIT 1`
    ).get(input.articleId, hashSnapshot(contentHashInput(input.snapshot))) as unknown as RevisionRow | undefined;
    if (!row) return null;
    const revision = parseRevisionRow<ContentRevisionSnapshot>(row);
    const reviewRow = this.db.prepare(
      `SELECT * FROM article_reviews
       WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(revision.id) as unknown as ReviewRow | undefined;
    return reviewRow ? { revision, review: parseReview(reviewRow) } : null;
  }

  async approveContent(input: {
    articleId: string;
    expectedUpdatedAt: string;
    revisionId: string;
    reviewId: string;
    reviewStatus: ContentReviewResult["status"];
  }): Promise<ContentWorkflowWriteResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revisionRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE id = ? AND article_id = ? AND scope = 'content'`
      ).get(input.revisionId, input.articleId) as unknown as RevisionRow | undefined;
      const latestRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE article_id = ? AND scope = 'content'
         ORDER BY version_number DESC LIMIT 1`
      ).get(input.articleId) as unknown as RevisionRow | undefined;
      if (!revisionRow || latestRow?.id !== revisionRow.id) return { kind: "conflict" };
      const snapshot = this.currentContentSnapshot(article);
      if (!snapshot) return { kind: "conflict" };
      if (revisionRow.content_hash !== hashSnapshot(contentHashInput(snapshot))) {
        return { kind: "conflict" };
      }
      const latestReviewRow = this.db.prepare(
        `SELECT * FROM article_reviews WHERE revision_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get(revisionRow.id) as unknown as ReviewRow | undefined;
      if (!latestReviewRow) return { kind: "conflict" };
      const latestReview = parseReview(latestReviewRow);
      if (latestReview.id !== input.reviewId || latestReview.result.status !== input.reviewStatus) {
        return { kind: "conflict" };
      }
      if (latestReview.result.status === "blocked") return { kind: "conflict" };
      const revision = parseRevisionRow<ContentRevisionSnapshot>(revisionRow);
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        status: "content_ready"
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "saved", article: updated, revision };
    });
  }

  async saveManualContentVersion(input: {
    articleId: string;
    expectedUpdatedAt: string;
    model: string;
    snapshot: ContentRevisionSnapshot;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revision = this.createRevision(input.articleId, input.snapshot, input.model, "manual");
      return { kind: "saved" as const, article, revision };
    });
  }

  async restoreContent(input: {
    articleId: string;
    versionId: string;
    expectedUpdatedAt: string;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revisionRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE id = ? AND article_id = ? AND scope = 'content'`
      ).get(input.versionId, input.articleId) as unknown as RevisionRow | undefined;
      if (!revisionRow) return { kind: "version_not_found" as const };
      const restoredFrom = parseRevisionRow<ContentRevisionSnapshot>(revisionRow);
      const snapshot = restoredFrom.snapshot;
      const revision = this.createRestoredRevision(input.articleId, snapshot, restoredFrom.model);
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        title: snapshot.title,
        blocks: mergeImageBlocks(snapshot.textBlocks, this.listImageAssets(article.id)),
        styleProfile: snapshot.styleProfile,
        status: "editing",
        planning: {
          ...article.planning,
          contentOutlineRevisionId: snapshot.outlineRevisionId
        }
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "restored" as const, article: updated, revision };
    });
  }

  async listContentVersions(articleId: string): Promise<ArticleRevision<ContentRevisionSnapshot>[]> {
    const rows = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'content'
       ORDER BY version_number DESC`
    ).all(articleId) as unknown as RevisionRow[];
    return rows.map((row) => parseRevisionRow<ContentRevisionSnapshot>(row));
  }

  async listContentReviews(articleId: string): Promise<ArticleReview<ContentReviewResult>[]> {
    const rows = this.db.prepare(
      `SELECT reviews.*
       FROM article_reviews reviews
       JOIN article_revisions revisions ON revisions.id = reviews.revision_id
       WHERE revisions.article_id = ? AND revisions.scope = 'content'
       ORDER BY reviews.created_at DESC, reviews.rowid DESC`
    ).all(articleId) as unknown as ReviewRow[];
    const latestByRevision = new Map<string, ArticleReview<ContentReviewResult>>();
    for (const row of rows) {
      if (!latestByRevision.has(row.revision_id)) {
        latestByRevision.set(row.revision_id, parseReview(row));
      }
    }
    return Array.from(latestByRevision.values());
  }

  private currentContentSnapshot(article: Article): ContentRevisionSnapshot | null {
    const outlineRevisionId = article.planning.contentOutlineRevisionId;
    const textBlocks = textBlocksOf(article.blocks);
    if (!outlineRevisionId || article.planning.recommendedTotalWords === null || !textBlocks.length) {
      return null;
    }
    return {
      title: article.title,
      textBlocks,
      outlineRevisionId,
      styleProfile: article.styleProfile,
      recommendedTotalWords: article.planning.recommendedTotalWords,
      sourceContextSnapshot: this.currentSourceContext(article.id)
    };
  }

  private createRevision(
    articleId: string,
    snapshot: ContentRevisionSnapshot,
    model: string | null,
    reason: RevisionReason
  ): ArticleRevision<ContentRevisionSnapshot> {
    const result = createRevisionIfChangedInTransaction(this.db, {
      articleId,
      scope: "content",
      snapshot,
      hashInput: contentHashInput(snapshot),
      model,
      reason
    });
    if ("kind" in result) throw new Error("保存正文版本时发生并发冲突");
    return result.revision;
  }

  /** 恢复是显式历史事件，即使内容与最新草稿一致也产生新版本。 */
  private createRestoredRevision(
    articleId: string,
    snapshot: ContentRevisionSnapshot,
    model: string | null
  ): ArticleRevision<ContentRevisionSnapshot> {
    const latestRow = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'content'
       ORDER BY version_number DESC LIMIT 1`
    ).get(articleId) as unknown as RevisionRow | undefined;
    const revision: ArticleRevision<ContentRevisionSnapshot> = {
      id: randomUUID(),
      articleId,
      scope: "content",
      version: (latestRow?.version_number ?? 0) + 1,
      contentHash: hashSnapshot(contentHashInput(snapshot)),
      snapshot,
      model,
      reason: "restored",
      createdAt: nextTimestamp(latestRow?.created_at)
    };
    this.db.prepare(
      `INSERT INTO article_revisions (
        id, article_id, scope, version_number, content_hash, snapshot_json,
        model, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      revision.id,
      revision.articleId,
      revision.scope,
      revision.version,
      revision.contentHash,
      JSON.stringify(revision.snapshot),
      revision.model,
      revision.reason,
      revision.createdAt
    );
    return revision;
  }

  private currentArticle(articleId: string, expectedUpdatedAt: string): Article | null {
    const row = this.db.prepare("SELECT * FROM articles WHERE id = ?").get(articleId) as unknown as ArticleRow | undefined;
    if (!row) return null;
    const article = parseArticle(row);
    return article.updatedAt === expectedUpdatedAt ? article : null;
  }

  private listImageAssets(articleId: string): ImageAsset[] {
    const rows = this.db.prepare(
      "SELECT * FROM image_assets WHERE article_id = ? ORDER BY position ASC"
    ).all(articleId) as unknown as ImageAssetRow[];
    return rows.map(parseAsset);
  }

  private currentSourceContext(articleId: string): string {
    const sources = this.db.prepare(
      `SELECT title, content, status, enabled FROM source_documents
       WHERE article_id = ? ORDER BY updated_at DESC, rowid DESC`
    ).all(articleId) as unknown as SourceRow[];
    return sources
      .filter((source) => source.enabled === 1 && source.status === "ready")
      .map((source) => `【${source.title}】\n${source.content}`)
      .join("\n\n")
      .slice(0, 8_000);
  }

  private missingOrConflict(articleId: string, expectedUpdatedAt: string): { kind: "not_found" } | { kind: "conflict" } {
    const row = this.db.prepare("SELECT updated_at FROM articles WHERE id = ?").get(articleId) as unknown as { updated_at: string } | undefined;
    return row && row.updated_at !== expectedUpdatedAt ? { kind: "conflict" } : { kind: "not_found" };
  }

  private writeArticle(
    article: Article,
    expectedUpdatedAt: string,
    change: Partial<Pick<Article, "title" | "blocks" | "status" | "planning" | "styleProfile">>
  ): Article | null {
    const updated: Article = { ...article, ...change, updatedAt: nextTimestamp(article.updatedAt) };
    const result = this.db.prepare(
      `UPDATE articles SET title = ?, status = ?, blocks_json = ?, planning_json = ?,
       style_json = ?, updated_at = ?
       WHERE id = ? AND updated_at = ?`
    ).run(
      updated.title,
      updated.status,
      JSON.stringify(updated.blocks),
      JSON.stringify(updated.planning),
      JSON.stringify(updated.styleProfile),
      updated.updatedAt,
      updated.id,
      expectedUpdatedAt
    ) as unknown as { changes: number };
    return result.changes === 1 ? updated : null;
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      if (error instanceof AbortMutation) return error.result as T;
      throw error;
    }
  }
}
