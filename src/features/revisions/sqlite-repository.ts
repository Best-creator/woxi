import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ArticleReview, ArticleRevision, CreateRevisionInput, RevisionScope } from "./domain";
import type {
  CreateRevisionResult,
  RevisionRepository,
  SaveReviewInput
} from "./repository";
import {
  createRevisionIfChangedInTransaction,
  parseRevisionRow
} from "./sqlite-store";

interface RevisionRow {
  id: string;
  article_id: string;
  scope: RevisionScope;
  version_number: number;
  content_hash: string;
  snapshot_json: string;
  model: string | null;
  reason: "generated" | "review_checkpoint" | "review_applied" | "confirmed" | "manual" | "restored";
  created_at: string;
}

interface ReviewRow {
  id: string;
  revision_id: string;
  model: string;
  result_json: string;
  created_at: string;
}

function parseReview<TResult>(row: ReviewRow): ArticleReview<TResult> {
  return {
    id: row.id,
    revisionId: row.revision_id,
    model: row.model,
    result: JSON.parse(row.result_json) as TResult,
    createdAt: row.created_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

function isUniqueRevisionConflict(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed: article_revisions\.article_id, article_revisions\.scope, article_revisions\.version_number/.test(error.message);
}

export class SqliteRevisionRepository implements RevisionRepository {
  constructor(private readonly db: DatabaseSync) {}

  async createIfChanged<TSnapshot>(
    input: CreateRevisionInput<TSnapshot>
  ): Promise<CreateRevisionResult<TSnapshot>> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = createRevisionIfChangedInTransaction(this.db, input);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the database failure that caused the rollback.
      }
      if (isUniqueRevisionConflict(error)) return { kind: "conflict" };
      throw error;
    }
  }

  async list<TSnapshot>(
    articleId: string,
    scope: RevisionScope
  ): Promise<ArticleRevision<TSnapshot>[]> {
    const rows = this.db.prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = ?
       ORDER BY version_number DESC`
    ).all(articleId, scope) as unknown as RevisionRow[];
    return rows.map((row) => parseRevisionRow<TSnapshot>(row));
  }

  async findById<TSnapshot>(id: string): Promise<ArticleRevision<TSnapshot> | null> {
    const row = this.db
      .prepare("SELECT * FROM article_revisions WHERE id = ?")
      .get(id) as unknown as RevisionRow | undefined;
    return row ? parseRevisionRow<TSnapshot>(row) : null;
  }

  async saveReview<TResult>(input: SaveReviewInput<TResult>): Promise<ArticleReview<TResult>> {
    const previous = this.db.prepare(
      `SELECT created_at FROM article_reviews
       WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(input.revisionId) as unknown as { created_at: string } | undefined;
    const review: ArticleReview<TResult> = {
      id: randomUUID(),
      revisionId: input.revisionId,
      model: input.model,
      result: input.result,
      createdAt: nextTimestamp(previous?.created_at)
    };
    this.db.prepare(`
      INSERT INTO article_reviews (id, revision_id, model, result_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      review.id,
      review.revisionId,
      review.model,
      JSON.stringify(review.result),
      review.createdAt
    );
    return review;
  }

  async latestReview<TResult>(revisionId: string): Promise<ArticleReview<TResult> | null> {
    const row = this.db.prepare(
      `SELECT * FROM article_reviews
       WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(revisionId) as unknown as ReviewRow | undefined;
    return row ? parseReview<TResult>(row) : null;
  }
}
