// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/../tests/helpers/test-db";
import { SqliteSettingsRepository } from "./sqlite-settings-repository";

describe("SqliteSettingsRepository", () => {
  it("returns null for missing keys", () => {
    const repository = new SqliteSettingsRepository(createTestDatabase());
    expect(repository.get("missing")).toBeNull();
  });

  it("stores and reads JSON values with an ISO updatedAt", () => {
    const repository = new SqliteSettingsRepository(createTestDatabase());
    const stored = repository.set("provider_overrides", { llm: { model: "grok-4.6" } });

    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const record = repository.get("provider_overrides");
    expect(record).not.toBeNull();
    expect(record?.value).toEqual({ llm: { model: "grok-4.6" } });
    expect(record?.updatedAt).toBe(stored.updatedAt);
  });

  it("upserts by key and refreshes updatedAt", () => {
    const repository = new SqliteSettingsRepository(createTestDatabase());
    repository.set("provider_overrides", { image: null });
    const second = repository.set("provider_overrides", { image: { apiKey: "k" } });

    expect(repository.get("provider_overrides")?.value).toEqual({ image: { apiKey: "k" } });
    expect(second.updatedAt >= repository.get("provider_overrides")!.updatedAt).toBe(true);
  });

  it("treats a corrupted row as no configuration", () => {
    const db = createTestDatabase();
    db.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('broken', '{oops', '2026-01-01T00:00:00.000Z')")
      .run();
    const repository = new SqliteSettingsRepository(db);
    expect(repository.get("broken")).toBeNull();
  });

  it("deletes rows", () => {
    const repository = new SqliteSettingsRepository(createTestDatabase());
    repository.set("provider_overrides", {});
    repository.delete("provider_overrides");
    expect(repository.get("provider_overrides")).toBeNull();
  });
});
