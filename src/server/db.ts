import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateDatabase(db);
  return db;
}

export function migrateDatabase(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      status TEXT NOT NULL,
      brief_json TEXT,
      outline_json TEXT NOT NULL,
      blocks_json TEXT NOT NULL,
      planning_json TEXT,
      style_json TEXT,
      outline_confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS articles_updated_at_idx
      ON articles(updated_at DESC);

    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS source_documents_article_idx
      ON source_documents(article_id, updated_at DESC);
 
    CREATE TABLE IF NOT EXISTS image_assets (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      anchor_block_id TEXT,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      prompt TEXT NOT NULL,
      alt_text TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      status TEXT NOT NULL,
      placeholder_url TEXT,
      file_path TEXT,
      public_url TEXT,
      consumed_blocks TEXT,
      manually_edited INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS image_assets_article_idx
      ON image_assets(article_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS image_assets_anchor_idx
      ON image_assets(anchor_block_id);

    CREATE TABLE IF NOT EXISTS image_asset_generations (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT,
      file_path TEXT,
      public_url TEXT,
      selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS image_asset_generations_asset_idx
      ON image_asset_generations(asset_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS image_asset_generations_article_idx
      ON image_asset_generations(article_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS reference_characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      persona TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_image_settings (
      article_id TEXT PRIMARY KEY,
      style TEXT NOT NULL DEFAULT '',
      character_id TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS style_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      profile_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wechat_drafts (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      title TEXT NOT NULL,
      theme_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS wechat_drafts_article_idx
      ON wechat_drafts(article_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS article_revisions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('outline', 'content')),
      version_number INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      model TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      UNIQUE(article_id, scope, version_number)
    );

    CREATE TABLE IF NOT EXISTS article_reviews (
      id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      model TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (revision_id) REFERENCES article_revisions(id) ON DELETE CASCADE
    );
    `);

    const columns = db
      .prepare("PRAGMA table_info(articles)")
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "outline_confirmed_at")) {
      db.exec("ALTER TABLE articles ADD COLUMN outline_confirmed_at TEXT");
    }
    if (!columns.some((column) => column.name === "planning_json")) {
      db.exec("ALTER TABLE articles ADD COLUMN planning_json TEXT");
    }
    if (!columns.some((column) => column.name === "style_json")) {
      db.exec("ALTER TABLE articles ADD COLUMN style_json TEXT");
    }

    const imageAssetColumns = db
      .prepare("PRAGMA table_info(image_assets)")
      .all() as unknown as Array<{ name: string }>;
    // 漫画长图靠它带着「被自己替换掉的正文快照」，取消长图时才能把原文原样放回去。
    // 老行是 NULL，读出来按「没有替换过正文」处理，语义上等于普通配图。
    if (!imageAssetColumns.some((column) => column.name === "consumed_blocks")) {
      db.exec("ALTER TABLE image_assets ADD COLUMN consumed_blocks TEXT");
    }
    if (!imageAssetColumns.some((column) => column.name === "position")) {
      db.exec(
        "ALTER TABLE image_assets ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
      );
      const assets = db
        .prepare(
          "SELECT id, article_id FROM image_assets ORDER BY article_id ASC, created_at ASC, rowid ASC"
        )
        .all() as unknown as Array<{ id: string; article_id: string }>;
      const updatePosition = db.prepare("UPDATE image_assets SET position = ? WHERE id = ?");
      let articleId: string | undefined;
      let position = 0;
      for (const asset of assets) {
        if (asset.article_id !== articleId) {
          articleId = asset.article_id;
          position = 0;
        }
        updatePosition.run(position, asset.id);
        position += 1;
      }
    }

    // 版本表是新加的，此前已经生成好的配图没有对应记录 —— 补一条「第 1 版」，
    // 否则老文章进配图步骤时版本条是空的，用户会以为图丢了。
    // file_path 原样沿用旧命名（{assetId}.{ext}），content 路由照常能读。
    // NOT EXISTS 保证可重复执行。
    db.exec(`
      INSERT INTO image_asset_generations (
        id, article_id, asset_id, prompt, model, file_path, public_url, selected, created_at
      )
      SELECT 'legacy-' || a.id, a.article_id, a.id, a.prompt, NULL,
             a.file_path, a.public_url, 1, a.updated_at
      FROM image_assets a
      WHERE a.status = 'generated'
        AND NOT EXISTS (
          SELECT 1 FROM image_asset_generations g WHERE g.asset_id = a.id
        );
    `);

    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original migration error is the useful failure.
    }
    throw error;
  }
}
