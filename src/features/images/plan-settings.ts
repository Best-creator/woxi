import type { DatabaseSync } from "node:sqlite";

/** 单篇文章的配图规划偏好：绘制风格与参考形象，重新进入配图步骤时回显。 */
export interface ImagePlanSettings {
  style: string;
  characterId: string | null;
}

export interface ImagePlanSettingsRepository {
  get(articleId: string): Promise<ImagePlanSettings>;
  set(articleId: string, settings: ImagePlanSettings): Promise<void>;
}

interface SettingsRow {
  style: string;
  character_id: string | null;
}

const DEFAULT_SETTINGS: ImagePlanSettings = { style: "", characterId: null };

export class SqliteImagePlanSettingsRepository implements ImagePlanSettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(articleId: string): Promise<ImagePlanSettings> {
    const row = this.db
      .prepare("SELECT style, character_id FROM article_image_settings WHERE article_id = ?")
      .get(articleId) as unknown as SettingsRow | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    return { style: row.style ?? "", characterId: row.character_id ?? null };
  }

  async set(articleId: string, settings: ImagePlanSettings): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO article_image_settings (article_id, style, character_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET style = excluded.style, character_id = excluded.character_id, updated_at = excluded.updated_at`
      )
      .run(articleId, settings.style, settings.characterId, new Date().toISOString());
  }
}
