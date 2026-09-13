import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  NewReferenceCharacter,
  ReferenceCharacter,
  ReferenceCharacterPatch,
  ReferenceCharacterRepository
} from "./domain";

interface ReferenceCharacterRow {
  id: string;
  name: string;
  persona: string;
  description: string;
  mime_type: string;
  file_path: string;
  created_at: string;
  updated_at: string;
}

function parseCharacter(row: ReferenceCharacterRow): ReferenceCharacter {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    description: row.description,
    mimeType: row.mime_type,
    filePath: row.file_path,
    publicUrl: `/api/characters/${row.id}/image`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, previousTime + 1)).toISOString();
}

export class SqliteReferenceCharacterRepository implements ReferenceCharacterRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<ReferenceCharacter[]> {
    const rows = this.db
      .prepare("SELECT * FROM reference_characters ORDER BY created_at ASC")
      .all() as unknown as ReferenceCharacterRow[];
    return rows.map(parseCharacter);
  }

  async findById(id: string): Promise<ReferenceCharacter | null> {
    const row = this.db
      .prepare("SELECT * FROM reference_characters WHERE id = ?")
      .get(id) as unknown as ReferenceCharacterRow | undefined;
    return row ? parseCharacter(row) : null;
  }

  async create(input: NewReferenceCharacter, id = randomUUID()): Promise<ReferenceCharacter> {
    const now = nextTimestamp();
    this.db
      .prepare(
        `INSERT INTO reference_characters (
          id, name, persona, description, mime_type, file_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.persona, input.description, input.mimeType, input.filePath, now, now);
    const created = await this.findById(id);
    if (!created) throw new Error("参考形象创建失败");
    return created;
  }

  async update(id: string, patch: ReferenceCharacterPatch): Promise<ReferenceCharacter | null> {
    const current = await this.findById(id);
    if (!current) return null;
    this.db
      .prepare(
        "UPDATE reference_characters SET name = ?, persona = ?, description = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        patch.name ?? current.name,
        patch.persona ?? current.persona,
        patch.description ?? current.description,
        nextTimestamp(current.updatedAt),
        id
      );
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM reference_characters WHERE id = ?")
      .run(id) as unknown as { changes: number };
    return result.changes > 0;
  }
}
