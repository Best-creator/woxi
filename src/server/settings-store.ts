import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteSettingsRepository } from "@/features/settings/sqlite-settings-repository";
import {
  PROVIDER_SETTINGS_KEY,
  parseProviderOverrideJson,
  type ProviderOverrideValue
} from "@/features/settings/provider-settings";
import { openDatabase } from "./db";

/**
 * 面板覆盖层的存取通道：独立于 services.getDatabase() 的惰性连接，
 * 避免 config.ts（读配置）→ services.ts（要配置开库）的循环依赖。
 * 覆盖行读取失败一律回落 env 默认层——配置存取出问题时应用行为退回旧版，不挡启动。
 */

interface StoreState {
  path: string;
  repository: SqliteSettingsRepository;
}

let store: StoreState | undefined;
let storeBroken = false;

function resolveDbPath(): string {
  const fromEnv = process.env.CONTENT_DB_PATH?.trim();
  return resolve(fromEnv || ".data/content-platform.db");
}

function getStore(): StoreState | null {
  if (storeBroken) return null;
  const path = resolveDbPath();
  if (store && store.path === path) return store;
  try {
    // 库文件不存在时视为「面板从未保存过」：零 IO，也不在测试/首次启动时凭空建库。
    if (!existsSync(path)) return null;
    store = { path, repository: new SqliteSettingsRepository(openDatabase(path)) };
    return store;
  } catch (error) {
    console.warn("app_settings 存取通道初始化失败，provider 覆盖层已停用", error);
    storeBroken = true;
    return null;
  }
}

export function loadProviderOverrides(): ProviderOverrideValue | null {
  const active = getStore();
  if (!active) return null;
  const record = active.repository.get(PROVIDER_SETTINGS_KEY);
  if (!record) return null;
  return parseProviderOverrideJson(JSON.stringify(record.value));
}

/** 覆盖行的 updatedAt（乐观并发基准）；无覆盖行时为 null。 */
export function loadProviderOverridesUpdatedAt(): string | null {
  const active = getStore();
  if (!active) return null;
  return active.repository.get(PROVIDER_SETTINGS_KEY)?.updatedAt ?? null;
}

/** 保存覆盖行；传 null 删除该行（全部回落 env 默认层）。返回新的 updatedAt。 */
export function saveProviderOverrides(value: ProviderOverrideValue | null): string {
  if (storeBroken) throw new Error("app_settings 存取通道不可用，无法保存配置");
  const existing = getStore();
  if (existing) {
    if (value === null) {
      existing.repository.delete(PROVIDER_SETTINGS_KEY);
      return "";
    }
    return existing.repository.set(PROVIDER_SETTINGS_KEY, value).updatedAt;
  }
  if (value === null) return "";
  // 库文件尚不存在（面板首次保存）：写路径允许建库（openDatabase 自带 mkdir + migrate）。
  const path = resolveDbPath();
  store = { path, repository: new SqliteSettingsRepository(openDatabase(path)) };
  return store.repository.set(PROVIDER_SETTINGS_KEY, value).updatedAt;
}

/** 测试钩子：丢弃惰性连接与失败缓存，让下下一次读取按新 CONTENT_DB_PATH 重开。 */
export function resetSettingsStoreForTest(): void {
  store = undefined;
  storeBroken = false;
}
