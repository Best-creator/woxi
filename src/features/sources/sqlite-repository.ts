import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SourceDocument, SourceStatus, SourceType } from "./domain";
import type { CreateSourceInput, SourceRepository } from "./repository";

interface SourceRow {
  id: string;
  article_id: string;
  title: string;
  type: SourceType;
  content: string;
  status: SourceStatus;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

function parseRow(row: SourceRow): SourceDocument {
  return {
    id: row.id,
    articleId: row.article_id,
    title: row.title,
    type: row.type,
    content: row.content,
    status: row.status,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function statusForType(type: SourceType): SourceStatus {
  return type === "text" || type === "markdown" ? "ready" : "unsupported";
}

export class SqliteSourceRepository implements SourceRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(articleId: string): Promise<SourceDocument[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM source_documents WHERE article_id = ? ORDER BY updated_at DESC, rowid DESC"
      )
      .all(articleId) as unknown as SourceRow[];
    return rows.map(parseRow);
  }

  async findById(
    articleId: string,
    sourceId: string
  ): Promise<SourceDocument | null> {
    const row = this.db
      .prepare(
        "SELECT * FROM source_documents WHERE article_id = ? AND id = ?"
      )
      .get(articleId, sourceId) as unknown as SourceRow | undefined;
    return row ? parseRow(row) : null;
  }

  async create(input: CreateSourceInput): Promise<SourceDocument> {
    const timestamp = nextTimestamp();
    const source: SourceDocument = {
      id: randomUUID(),
      articleId: input.articleId,
      title: input.title.trim(),
      type: input.type,
      content: input.content,
      status: statusForType(input.type),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(`
        INSERT INTO source_documents (
          id, article_id, title, type, content, status, enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.articleId,
        source.title,
        source.type,
        source.content,
        source.status,
        1,
        source.createdAt,
        source.updatedAt
      );

    return source;
  }

  async updateEnabled(
    articleId: string,
    sourceId: string,
    enabled: boolean
  ): Promise<SourceDocument | null> {
    const current = await this.findById(articleId, sourceId);
    if (!current) return null;
    const updatedAt = nextTimestamp(current.updatedAt);
    this.db
      .prepare(
        "UPDATE source_documents SET enabled = ?, updated_at = ? WHERE article_id = ? AND id = ?"
      )
      .run(enabled ? 1 : 0, updatedAt, articleId, sourceId);
    return { ...current, enabled, updatedAt };
  }

  async remove(articleId: string, sourceId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM source_documents WHERE article_id = ? AND id = ?")
      .run(articleId, sourceId);
    return result.changes > 0;
  }
}
