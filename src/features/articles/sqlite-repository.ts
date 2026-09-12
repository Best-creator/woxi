import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_STYLE_PROFILE,
  parseStyleProfileJson
} from "@/features/content/style-profile";
import {
  DEFAULT_ARTICLE_PLANNING,
  type Article,
  type ArticlePlanning,
  type ArticleStatus,
  type ContentBlock,
  type KnowledgeBrief,
  type OutlineSection
} from "./domain";
import type { ArticleRepository, SaveArticleResult } from "./repository";

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

function parsePlanning(planningJson: string | null): ArticlePlanning {
  return planningJson
    ? (JSON.parse(planningJson) as ArticlePlanning)
    : { ...DEFAULT_ARTICLE_PLANNING };
}

export { parseStyleProfileJson as parseStyleProfile };

function parseRow(row: ArticleRow): Article {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status,
    brief: row.brief_json
      ? (JSON.parse(row.brief_json) as KnowledgeBrief)
      : null,
    outline: JSON.parse(row.outline_json) as OutlineSection[],
    blocks: JSON.parse(row.blocks_json) as ContentBlock[],
    planning: parsePlanning(row.planning_json),
    styleProfile: parseStyleProfileJson(row.style_json),
    outlineConfirmedAt: row.outline_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

export class SqliteArticleRepository implements ArticleRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<Article[]> {
    const rows = this.db
      .prepare("SELECT * FROM articles ORDER BY updated_at DESC, rowid DESC")
      .all() as unknown as ArticleRow[];
    return rows.map(parseRow);
  }

  async findById(id: string): Promise<Article | null> {
    const row = this.db
      .prepare("SELECT * FROM articles WHERE id = ?")
      .get(id) as unknown as ArticleRow | undefined;
    return row ? parseRow(row) : null;
  }

  async create(input: { topic: string; title?: string }): Promise<Article> {
    const timestamp = nextTimestamp();
    const article: Article = {
      id: randomUUID(),
      title: input.title?.trim() || input.topic,
      topic: input.topic,
      status: "draft",
      brief: null,
      outline: [],
      blocks: [],
      planning: { ...DEFAULT_ARTICLE_PLANNING },
      styleProfile: { ...DEFAULT_STYLE_PROFILE },
      outlineConfirmedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(`
        INSERT INTO articles (
          id, title, topic, status, brief_json, outline_json,
          blocks_json, planning_json, style_json, outline_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        article.id,
        article.title,
        article.topic,
        article.status,
        null,
        "[]",
        "[]",
        JSON.stringify(article.planning),
        JSON.stringify(article.styleProfile),
        null,
        article.createdAt,
        article.updatedAt
      );

    return article;
  }

  async save(
    article: Article,
    expectedUpdatedAt: string
  ): Promise<SaveArticleResult> {
    const updatedAt = nextTimestamp(expectedUpdatedAt);
    const result = this.db
      .prepare(`
        UPDATE articles
        SET title = ?, topic = ?, status = ?, brief_json = ?,
            outline_json = ?, blocks_json = ?, planning_json = ?, updated_at = ?
            , style_json = ?, outline_confirmed_at = ?
        WHERE id = ? AND updated_at = ?
      `)
      .run(
        article.title,
        article.topic,
        article.status,
        article.brief ? JSON.stringify(article.brief) : null,
        JSON.stringify(article.outline),
        JSON.stringify(article.blocks),
        JSON.stringify(article.planning),
        updatedAt,
        JSON.stringify(article.styleProfile),
        article.outlineConfirmedAt,
        article.id,
        expectedUpdatedAt
      );

    if (result.changes === 0) {
      return { kind: "conflict" };
    }

    return {
      kind: "saved",
      article: { ...article, updatedAt }
    };
  }
}
