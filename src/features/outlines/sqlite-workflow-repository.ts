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
import { hashSnapshot } from "@/features/revisions/content-hash";
import type {
  ArticleReview,
  ArticleRevision,
  OutlineRevisionSnapshot,
  RevisionReason,
  RevisionScope
} from "@/features/revisions/domain";
import {
  createRevisionIfChangedInTransaction,
  parseRevisionRow
} from "@/features/revisions/sqlite-store";
import type { OutlineReviewResult } from "./domain";
import {
  type OutlineSnapshotInput,
  type OutlineWorkflowRepository,
  type OutlineWorkflowWriteResult,
  toOutlineRevisionSnapshot
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

function parseReview(row: ReviewRow): ArticleReview<OutlineReviewResult> {
  return {
    id: row.id,
    revisionId: row.revision_id,
    model: row.model,
    result: JSON.parse(row.result_json) as OutlineReviewResult,
    createdAt: row.created_at
  };
}

/** The only aggregate writer for outline articles and immutable outline revisions. */
export class SqliteOutlineWorkflowRepository implements OutlineWorkflowRepository {
  constructor(private readonly db: DatabaseSync) {}

  async saveGeneratedOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
    reason?: Extract<RevisionReason, "generated" | "review_applied">;
  }): Promise<OutlineWorkflowWriteResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revision = this.createRevision(input, input.reason ?? "generated");
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        title: input.title,
        brief: input.brief,
        outline: input.outline,
        blocks: [],
        status: "brief_ready",
        planning: {
          lengthPreset: input.lengthPreset,
          recommendedTotalWords: input.recommendedTotalWords,
          confirmedOutlineRevisionId: null,
          contentOutlineRevisionId: null
        },
        outlineConfirmedAt: null
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "saved", article: updated, revision };
    });
  }

  async checkpointOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string | null;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      return { kind: "checkpointed" as const, revision: this.createRevision(input, "review_checkpoint") };
    });
  }

  async saveOutlineReview(input: {
    revisionId: string;
    model: string;
    result: OutlineReviewResult;
  }): Promise<ArticleReview<OutlineReviewResult>> {
    return this.inTransaction(() => {
      const previous = this.db.prepare(
        `SELECT created_at FROM article_reviews
         WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get(input.revisionId) as unknown as { created_at: string } | undefined;
      const review: ArticleReview<OutlineReviewResult> = {
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

  async findCurrentOutlineReview(input: {
    articleId: string;
    snapshot: OutlineRevisionSnapshot;
  }) {
    const row = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'outline' AND content_hash = ?
       ORDER BY version_number DESC LIMIT 1`
    ).get(input.articleId, hashSnapshot(input.snapshot)) as unknown as RevisionRow | undefined;
    if (!row) return null;
    const revision = parseRevisionRow<OutlineRevisionSnapshot>(row);
    const reviewRow = this.db.prepare(
      `SELECT * FROM article_reviews
       WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(revision.id) as unknown as ReviewRow | undefined;
    return reviewRow ? { revision, review: parseReview(reviewRow) } : null;
  }

  async confirmOutline(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    revisionId: string;
    reviewId: string;
    reviewStatus: OutlineReviewResult["status"];
  }): Promise<OutlineWorkflowWriteResult> {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      if (!article.brief || article.planning.recommendedTotalWords === null) {
        return { kind: "conflict" };
      }
      const currentSnapshot: OutlineRevisionSnapshot = {
        title: article.title,
        brief: article.brief,
        outline: article.outline,
        lengthPreset: article.planning.lengthPreset,
        recommendedTotalWords: article.planning.recommendedTotalWords,
        sourceContextSnapshot: this.currentSourceContext(article.id)
      };
      if (hashSnapshot(currentSnapshot) !== hashSnapshot(toOutlineRevisionSnapshot(input))) {
        return { kind: "conflict" };
      }
      const revisionRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE id = ? AND article_id = ? AND scope = 'outline'`
      ).get(input.revisionId, input.articleId) as unknown as RevisionRow | undefined;
      const latestRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE article_id = ? AND scope = 'outline'
         ORDER BY version_number DESC LIMIT 1`
      ).get(input.articleId) as unknown as RevisionRow | undefined;
      if (!revisionRow || latestRow?.id !== revisionRow.id || revisionRow.content_hash !== hashSnapshot(currentSnapshot)) {
        return { kind: "conflict" };
      }
      const revision = parseRevisionRow<OutlineRevisionSnapshot>(revisionRow);
      const latestReviewRow = this.db.prepare(
        `SELECT * FROM article_reviews WHERE revision_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get(revision.id) as unknown as ReviewRow | undefined;
      if (!latestReviewRow) return { kind: "conflict" };
      const latestReview = parseReview(latestReviewRow);
      if (latestReview.id !== input.reviewId || latestReview.result.status !== input.reviewStatus) {
        return { kind: "conflict" };
      }
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        blocks: [],
        planning: {
          ...article.planning,
          lengthPreset: input.lengthPreset,
          recommendedTotalWords: input.recommendedTotalWords,
          confirmedOutlineRevisionId: revision.id,
          contentOutlineRevisionId: null
        },
        status: "outline_ready",
        outlineConfirmedAt: nextTimestamp(article.outlineConfirmedAt ?? article.updatedAt)
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "saved", article: updated, revision };
    });
  }

  async saveManualOutlineVersion(input: OutlineSnapshotInput & {
    articleId: string;
    expectedUpdatedAt: string;
    model: string;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revision = this.createRevision(input, "manual");
      return { kind: "saved" as const, article, revision };
    });
  }

  async restoreOutline(input: {
    articleId: string;
    versionId: string;
    expectedUpdatedAt: string;
  }) {
    return this.inTransaction(() => {
      const article = this.currentArticle(input.articleId, input.expectedUpdatedAt);
      if (!article) return this.missingOrConflict(input.articleId, input.expectedUpdatedAt);
      const revisionRow = this.db.prepare(
        `SELECT * FROM article_revisions
         WHERE id = ? AND article_id = ? AND scope = 'outline'`
      ).get(input.versionId, input.articleId) as unknown as RevisionRow | undefined;
      if (!revisionRow) return { kind: "version_not_found" as const };
      const restoredFrom = parseRevisionRow<OutlineRevisionSnapshot>(revisionRow);
      const snapshot = restoredFrom.snapshot;
      const revision = this.createRestoredRevision({
        articleId: input.articleId,
        ...snapshot,
        model: restoredFrom.model
      });
      const updated = this.writeArticle(article, input.expectedUpdatedAt, {
        title: snapshot.title,
        brief: snapshot.brief,
        outline: snapshot.outline,
        blocks: [],
        status: "brief_ready",
        planning: {
          lengthPreset: snapshot.lengthPreset,
          recommendedTotalWords: snapshot.recommendedTotalWords,
          confirmedOutlineRevisionId: null,
          contentOutlineRevisionId: null
        },
        outlineConfirmedAt: null
      });
      if (!updated) throw new AbortMutation({ kind: "conflict" });
      return { kind: "restored" as const, article: updated, revision };
    });
  }

  async listOutlineVersions(articleId: string): Promise<ArticleRevision<OutlineRevisionSnapshot>[]> {
    const rows = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'outline'
       ORDER BY version_number DESC`
    ).all(articleId) as unknown as RevisionRow[];
    return rows.map((row) => parseRevisionRow<OutlineRevisionSnapshot>(row));
  }

  async listOutlineReviews(articleId: string): Promise<ArticleReview<OutlineReviewResult>[]> {
    const rows = this.db.prepare(
      `SELECT reviews.*
       FROM article_reviews reviews
       JOIN article_revisions revisions ON revisions.id = reviews.revision_id
       WHERE revisions.article_id = ? AND revisions.scope = 'outline'
       ORDER BY reviews.created_at DESC, reviews.rowid DESC`
    ).all(articleId) as unknown as ReviewRow[];
    const latestByRevision = new Map<string, ArticleReview<OutlineReviewResult>>();
    for (const row of rows) {
      if (!latestByRevision.has(row.revision_id)) {
        latestByRevision.set(row.revision_id, parseReview(row));
      }
    }
    return Array.from(latestByRevision.values());
  }

  private createRevision(input: OutlineSnapshotInput & { articleId: string; model: string | null }, reason: RevisionReason) {
    const result = createRevisionIfChangedInTransaction(this.db, {
      articleId: input.articleId,
      scope: "outline",
      snapshot: toOutlineRevisionSnapshot(input),
      model: input.model,
      reason
    });
    if ("kind" in result) throw new Error("保存纲要版本时发生并发冲突");
    return result.revision;
  }

  /** Restores are explicit history events, even when the restored snapshot equals the latest draft. */
  private createRestoredRevision(input: OutlineSnapshotInput & { articleId: string; model: string | null }): ArticleRevision<OutlineRevisionSnapshot> {
    const latestRow = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = 'outline'
       ORDER BY version_number DESC LIMIT 1`
    ).get(input.articleId) as unknown as RevisionRow | undefined;
    const snapshot = toOutlineRevisionSnapshot(input);
    const revision: ArticleRevision<OutlineRevisionSnapshot> = {
      id: randomUUID(),
      articleId: input.articleId,
      scope: "outline",
      version: (latestRow?.version_number ?? 0) + 1,
      contentHash: hashSnapshot(snapshot),
      snapshot,
      model: input.model,
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
    change: Partial<Pick<Article, "title" | "brief" | "outline" | "blocks" | "status" | "planning" | "outlineConfirmedAt">>
  ): Article | null {
    const updated: Article = { ...article, ...change, updatedAt: nextTimestamp(article.updatedAt) };
    const result = this.db.prepare(
      `UPDATE articles SET title = ?, status = ?, brief_json = ?, outline_json = ?,
       blocks_json = ?, planning_json = ?, outline_confirmed_at = ?, updated_at = ?
       WHERE id = ? AND updated_at = ?`
    ).run(
      updated.title,
      updated.status,
      updated.brief ? JSON.stringify(updated.brief) : null,
      JSON.stringify(updated.outline),
      JSON.stringify(updated.blocks),
      JSON.stringify(updated.planning),
      updated.outlineConfirmedAt,
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
