import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashSnapshot } from "./content-hash";
import type { ArticleRevision, CreateRevisionInput, RevisionReason, RevisionScope } from "./domain";
import type { CreateRevisionResult } from "./repository";

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

function parseRevision<TSnapshot>(row: RevisionRow): ArticleRevision<TSnapshot> {
  return {
    id: row.id,
    articleId: row.article_id,
    scope: row.scope,
    version: row.version_number,
    contentHash: row.content_hash,
    snapshot: JSON.parse(row.snapshot_json) as TSnapshot,
    model: row.model,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

/**
 * This helper intentionally assumes its caller already owns the transaction.
 */
export function createRevisionIfChangedInTransaction<TSnapshot>(
  db: DatabaseSync,
  input: CreateRevisionInput<TSnapshot>
): CreateRevisionResult<TSnapshot> {
  const latestRow = db
    .prepare(
      `SELECT * FROM article_revisions
       WHERE article_id = ? AND scope = ?
       ORDER BY version_number DESC LIMIT 1`
    )
    .get(input.articleId, input.scope) as unknown as RevisionRow | undefined;
  const contentHash = hashSnapshot(input.hashInput ?? input.snapshot);

  if (latestRow?.content_hash === contentHash) {
    return { revision: parseRevision<TSnapshot>(latestRow), created: false };
  }

  const revision: ArticleRevision<TSnapshot> = {
    id: randomUUID(),
    articleId: input.articleId,
    scope: input.scope,
    version: (latestRow?.version_number ?? 0) + 1,
    contentHash,
    snapshot: input.snapshot,
    model: input.model,
    reason: input.reason,
    createdAt: nextTimestamp(latestRow?.created_at)
  };
  db.prepare(`
    INSERT INTO article_revisions (
      id, article_id, scope, version_number, content_hash, snapshot_json,
      model, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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

  return { revision, created: true };
}

export function parseRevisionRow<TSnapshot>(row: RevisionRow): ArticleRevision<TSnapshot> {
  return parseRevision<TSnapshot>(row);
}
