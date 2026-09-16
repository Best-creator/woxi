import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { StyleLibraryEntry, StyleLibraryRepository, StyleProfile } from "./domain";

interface StyleLibraryRow {
  id: string;
  name: string;
  profile_json: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function parseEntry(row: StyleLibraryRow): StyleLibraryEntry {
  return {
    id: row.id,
    name: row.name,
    profile: JSON.parse(row.profile_json) as StyleProfile,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteStyleLibraryRepository implements StyleLibraryRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<StyleLibraryEntry[]> {
    const rows = this.db
      .prepare("SELECT * FROM style_library ORDER BY name COLLATE NOCASE ASC")
      .all() as unknown as StyleLibraryRow[];
    return rows.map(parseEntry);
  }

  async findById(id: string): Promise<StyleLibraryEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM style_library WHERE id = ?")
      .get(id) as unknown as StyleLibraryRow | undefined;
    return row ? parseEntry(row) : null;
  }

  async upsert(profile: StyleProfile, source: string, id = randomUUID()): Promise<StyleLibraryEntry> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO style_library (id, name, profile_json, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           profile_json = excluded.profile_json,
           source = excluded.source,
           updated_at = excluded.updated_at`
      )
      .run(id, profile.name, JSON.stringify(profile), source, now, now);
    const row = this.db
      // upsert 冲突时 id 仍是旧记录的 id（excluded.id 未生效），按 name 读回真实记录。
      .prepare("SELECT * FROM style_library WHERE name = ?")
      .get(profile.name) as unknown as StyleLibraryRow;
    return parseEntry(row);
  }
}
