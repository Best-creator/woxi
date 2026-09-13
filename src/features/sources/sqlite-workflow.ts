import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseStyleProfileJson } from "@/features/content/style-profile";
import type { Article, ArticleStatus } from "@/features/articles/domain";
import type { SourceDocument, SourceType } from "./domain";

type SourceRow = {
  id: string; article_id: string; title: string; type: SourceType; content: string;
  status: SourceDocument["status"]; enabled: number; created_at: string; updated_at: string;
};
type ArticleRow = {
  id: string; title: string; topic: string; status: ArticleStatus; brief_json: string | null;
  outline_json: string; blocks_json: string; planning_json: string; style_json: string | null;
  outline_confirmed_at: string | null; created_at: string; updated_at: string;
};

function timestamp(previous: string) { return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString(); }
function source(row: SourceRow): SourceDocument { return { id: row.id, articleId: row.article_id, title: row.title, type: row.type, content: row.content, status: row.status, enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at }; }
function article(row: ArticleRow): Article {
  return { id: row.id, title: row.title, topic: row.topic, status: row.status, brief: row.brief_json ? JSON.parse(row.brief_json) : null, outline: JSON.parse(row.outline_json), blocks: JSON.parse(row.blocks_json), planning: JSON.parse(row.planning_json), styleProfile: parseStyleProfileJson(row.style_json), outlineConfirmedAt: row.outline_confirmed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export type SourceMutationResult =
  | { kind: "saved"; article: Article; source?: SourceDocument }
  | { kind: "not_found"; target: "article" | "source" }
  | { kind: "conflict" };

export class SqliteSourceWorkflow {
  constructor(private readonly db: DatabaseSync) {}

  async create(articleId: string, expectedUpdatedAt: string, input: { title: string; type: SourceType; content: string }): Promise<SourceMutationResult> {
    return this.mutate(articleId, expectedUpdatedAt, () => {
      const at = timestamp(expectedUpdatedAt);
      // text/markdown/web 的内容本身就是可读文本，直接可用；
      // pdf/docx 需要先经解析流程，保持 unsupported。
      const created: SourceDocument = { id: randomUUID(), articleId, title: input.title, type: input.type, content: input.content, status: input.type === "text" || input.type === "markdown" || input.type === "web" ? "ready" : "unsupported", enabled: true, createdAt: at, updatedAt: at };
      this.db.prepare("INSERT INTO source_documents (id, article_id, title, type, content, status, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(created.id, created.articleId, created.title, created.type, created.content, created.status, 1, at, at);
      return created;
    });
  }

  async updateEnabled(articleId: string, sourceId: string, expectedUpdatedAt: string, enabled: boolean): Promise<SourceMutationResult> {
    return this.mutate(articleId, expectedUpdatedAt, () => {
      const current = this.db.prepare("SELECT * FROM source_documents WHERE article_id = ? AND id = ?").get(articleId, sourceId) as SourceRow | undefined;
      if (!current) return null;
      const at = timestamp(current.updated_at);
      this.db.prepare("UPDATE source_documents SET enabled = ?, updated_at = ? WHERE article_id = ? AND id = ?").run(enabled ? 1 : 0, at, articleId, sourceId);
      return { ...source(current), enabled, updatedAt: at };
    });
  }

  async remove(articleId: string, sourceId: string, expectedUpdatedAt: string): Promise<SourceMutationResult> {
    return this.mutate(articleId, expectedUpdatedAt, () => {
      const current = this.db.prepare("SELECT id FROM source_documents WHERE article_id = ? AND id = ?").get(articleId, sourceId);
      if (!current) return null;
      this.db.prepare("DELETE FROM source_documents WHERE article_id = ? AND id = ?").run(articleId, sourceId);
      return undefined;
    });
  }

  private mutate(articleId: string, expectedUpdatedAt: string, sourceMutation: () => SourceDocument | null | undefined): SourceMutationResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db.prepare("SELECT * FROM articles WHERE id = ?").get(articleId) as ArticleRow | undefined;
      if (!current) { this.db.exec("ROLLBACK"); return { kind: "not_found", target: "article" }; }
      if (current.updated_at !== expectedUpdatedAt) { this.db.exec("ROLLBACK"); return { kind: "conflict" }; }
      const changed = sourceMutation();
      if (changed === null) { this.db.exec("ROLLBACK"); return { kind: "not_found", target: "source" }; }
      const next = article(current);
      const invalidated: Article = { ...next, blocks: [], planning: { ...next.planning, confirmedOutlineRevisionId: null, contentOutlineRevisionId: null }, outlineConfirmedAt: null, status: next.brief ? "brief_ready" : "draft", updatedAt: timestamp(current.updated_at) };
      this.db.prepare("UPDATE articles SET status = ?, blocks_json = ?, planning_json = ?, outline_confirmed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?").run(invalidated.status, "[]", JSON.stringify(invalidated.planning), null, invalidated.updatedAt, articleId, expectedUpdatedAt);
      this.db.exec("COMMIT");
      return { kind: "saved", article: invalidated, ...(changed ? { source: changed } : {}) };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
