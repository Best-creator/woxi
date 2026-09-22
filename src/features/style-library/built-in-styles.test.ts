import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_MINIMAL_ACTION_STYLE_NAME,
  ensureBuiltInStyles
} from "./built-in-styles";
import { StyleProfileSchema } from "./domain";
import type { StyleLibraryEntry, StyleLibraryRepository, StyleProfile } from "./domain";

function entryFrom(profile: StyleProfile): StyleLibraryEntry {
  return {
    id: `style-${profile.name}`,
    name: profile.name,
    profile,
    source: "内置风格（连贯叙事配套）",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z"
  };
}

function memoryRepo(entries: StyleLibraryEntry[] = []) {
  const upsert = vi.fn(async (profile: StyleProfile) => {
    const existing = entries.findIndex((entry) => entry.name === profile.name);
    const entry = entryFrom(profile);
    if (existing >= 0) entries[existing] = entry;
    else entries.push(entry);
    return entry;
  });
  return { upsert, entries } as unknown as {
    upsert: ReturnType<typeof vi.fn>;
    entries: StyleLibraryEntry[];
  } & StyleLibraryRepository;
}

describe("built-in styles", () => {
  it("upserts built-ins by name, at most once per process", async () => {
    const repo = memoryRepo();
    await ensureBuiltInStyles(repo);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0]!.name).toBe(BUILT_IN_MINIMAL_ACTION_STYLE_NAME);

    // 第二次调用（同进程）直接跳过：列表路由每次 GET 都会喊 ensure，不能每次都写库。
    await ensureBuiltInStyles(repo);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });

  it("keeps the built-in profile valid for the style library schema", async () => {
    // 内置画像必须与 style-lab 导入的画像同构：字段约束一致才能走同一条 upsert 通道。
    const repo = memoryRepo();
    await ensureBuiltInStyles(repo);
    const profile = repo.upsert.mock.calls[0]?.[0] as StyleProfile;
    expect(() => StyleProfileSchema.parse(profile)).not.toThrow();
    // 配套画风的三条命脉：极简背景、无画字、角色造型锁定（与 novel_narrator 文风同一审美）。
    expect(profile.background).toContain("纯白留白");
    expect(profile.textRendering).toContain("不出现任何文字");
    expect(profile.characterDesign).toContain("全篇锁定");
  });

  it("swallows upsert failures so the list route never breaks", async () => {
    const repo = memoryRepo();
    repo.upsert.mockRejectedValueOnce(new Error("table locked"));
    await expect(ensureBuiltInStyles(repo)).resolves.toBeUndefined();
  });
});
