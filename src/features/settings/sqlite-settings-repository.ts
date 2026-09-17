import type { DatabaseSync } from "node:sqlite";

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * app_settings 表的通用 KV 仓储。value_json 解析失败按「无配置」处理并告警——
 * 配置损坏不该挡住应用启动，读取方回落 env 默认层。
 */
export class SqliteSettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): SettingRecord | null {
    const row = this.db
      .prepare("SELECT value_json, updated_at FROM app_settings WHERE key = ?")
      .get(key) as unknown as { value_json: string; updated_at: string } | undefined;
    if (!row) return null;
    try {
      return { key, value: JSON.parse(row.value_json), updatedAt: row.updated_at };
    } catch {
      console.warn(`app_settings 行 ${key} 的 JSON 无法解析，按无配置处理`);
      return null;
    }
  }

  set(key: string, value: unknown): SettingRecord {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), updatedAt);
    return { key, value, updatedAt };
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }
}
