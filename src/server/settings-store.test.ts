// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadProviderOverrides,
  loadProviderOverridesUpdatedAt,
  resetSettingsStoreForTest,
  saveProviderOverrides
} from "./settings-store";

const TEST_DB_PATH = ".data/settings-store-test.db";

function useDbPath(path: string | undefined) {
  if (path === undefined) delete process.env.CONTENT_DB_PATH;
  else process.env.CONTENT_DB_PATH = path;
  resetSettingsStoreForTest();
}

describe("settings-store", () => {
  beforeEach(() => {
    useDbPath(TEST_DB_PATH);
  });

  afterEach(() => {
    useDbPath(undefined);
  });

  it("reports no overrides before anything is saved", () => {
    // 首个用例可能读到上一轮残留行——先归零。
    saveProviderOverrides(null);
    expect(loadProviderOverrides()).toBeNull();
    expect(loadProviderOverridesUpdatedAt()).toBeNull();
  });

  it("saves, reads and updates the override row", () => {
    const firstUpdatedAt = saveProviderOverrides({ llm: { baseUrl: "https://llm.example.test", apiKey: "k1", model: "grok-4.6", models: "", researchModel: "", reviewModel: "", visualModel: "", visionModel: "" } });
    expect(loadProviderOverrides()).toEqual({ llm: { baseUrl: "https://llm.example.test", apiKey: "k1", model: "grok-4.6", models: "", researchModel: "", reviewModel: "", visualModel: "", visionModel: "" } });
    expect(loadProviderOverridesUpdatedAt()).toBe(firstUpdatedAt);

    const secondUpdatedAt = saveProviderOverrides({ image: null });
    expect(loadProviderOverrides()).toEqual({ image: null });
    expect(loadProviderOverridesUpdatedAt()).toBe(secondUpdatedAt);
    expect(secondUpdatedAt >= firstUpdatedAt).toBe(true);
  });

  it("deletes the override row when saving null", () => {
    saveProviderOverrides({ llm: { baseUrl: "https://llm.example.test", apiKey: "k2", model: "x", models: "", researchModel: "", reviewModel: "", visualModel: "", visionModel: "" } });
    saveProviderOverrides(null);
    expect(loadProviderOverrides()).toBeNull();
    expect(loadProviderOverridesUpdatedAt()).toBeNull();
  });

  it("treats a missing database file as no overrides", () => {
    useDbPath(".data/settings-store-missing.db");
    expect(loadProviderOverrides()).toBeNull();
    expect(loadProviderOverridesUpdatedAt()).toBeNull();
  });

  it("falls back to env defaults and rejects saves when the store cannot open", () => {
    // CONTENT_DB_PATH 指向目录：existsSync 通过但 Sqlite 打不开 → 失败缓存生效。
    useDbPath(".data");
    expect(loadProviderOverrides()).toBeNull();
    expect(() => saveProviderOverrides({})).toThrow(/存取通道不可用/);
    // 失败被缓存：再次读取不再尝试打开。
    expect(loadProviderOverrides()).toBeNull();
  });
});
