// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { SqliteStyleLibraryRepository } from "./sqlite-repository";
import { importStyles } from "./import-styles";
import type { StyleProfile } from "./domain";

const PROFILE_A: StyleProfile = {
  name: "Q版手绘科普",
  summary: "低饱和土黄色调的Q版手绘科普卡片画风",
  palette: ["#bfb3a2", "#8d7e6f", "#66574e"],
  lineWork: "不均匀细抖动描边，带有手绘颤动感",
  characterDesign: "两头身圆脸小动物，腮红明显",
  composition: "主体居中，顶部留出大字标题区",
  background: "米黄纸纹底，轻微颗粒质感",
  textRendering: "顶部大字标题，正文手写体配拼音格",
  promptTemplate:
    "画面采用Q版手绘科普卡片风格：低饱和土黄色调、不均匀抖动细描边、两头身圆脸角色、米黄纸纹背景，整体温暖治愈，像纸质科普卡片。"
};

const PROFILE_B: StyleProfile = {
  ...PROFILE_A,
  name: "写实野生动物摄影",
  summary: "自然光下的野生摄影风格，景深分明",
  promptTemplate:
    "画面采用自然纪实摄影风格：真实光影、浅景深、野生动物神态自然，如国家地理杂志插图，色彩还原真实不带卡通化处理。"
};

function exportFile(styles: StyleProfile[], version = 1) {
  return { version, exportedAt: "2026-09-15T00:00:00.000Z", source: "style-lab", styles };
}

describe("importStyles", () => {
  it("导入两条风格并按 name 幂等去重；重复导入同一文件全部跳过", async () => {
    const repo = new SqliteStyleLibraryRepository(createTestDatabase());

    const first = await importStyles(exportFile([PROFILE_A, PROFILE_B]), repo);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);
    expect(first.errors).toEqual([]);
    expect((await repo.list()).map((entry) => entry.name)).toEqual(
      ["Q版手绘科普", "写实野生动物摄影"].sort((a, b) => (a < b ? -1 : 1))
    );

    // 同名同内容 → 全部跳过
    const repeat = await importStyles(exportFile([PROFILE_A, PROFILE_B]), repo);
    expect(repeat.imported).toBe(0);
    expect(repeat.skipped).toBe(2);

    // 同名不同内容 → 覆盖更新，id 不变
    const before = (await repo.findById((await repo.list())[0].id))!;
    const updated = await importStyles(
      exportFile([{ ...PROFILE_A, summary: "更新后的一句话概括，仍然足够长" }]),
      repo
    );
    expect(updated.imported).toBe(1);
    const after = (await repo.list()).find((entry) => entry.name === PROFILE_A.name)!;
    expect(after.id).toBe(before.id);
    expect(after.profile.summary).toBe("更新后的一句话概括，仍然足够长");
  });

  it("version 不匹配或结构坏时整体拒绝，给出可读错误", async () => {
    const repo = new SqliteStyleLibraryRepository(createTestDatabase());
    const badVersion = await importStyles(exportFile([PROFILE_A], 2), repo);
    expect(badVersion.imported).toBe(0);
    expect(badVersion.errors[0]).toContain("导出文件格式无效");

    const notAnObject = await importStyles([PROFILE_A], repo);
    expect(notAnObject.imported).toBe(0);
    expect(notAnObject.errors[0]).toContain("导出文件格式无效");
  });

  it("单条字段违规时整体拒绝并指出位置（Zod 严格校验防脏数据入库）", async () => {
    const repo = new SqliteStyleLibraryRepository(createTestDatabase());
    const broken = exportFile([{ ...PROFILE_A, palette: ["#bfb3a2"] }]);
    const result = await importStyles(broken, repo);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("styles.0");
  });

  it("repo 往返：findById 命中与未命中", async () => {
    const repo = new SqliteStyleLibraryRepository(createTestDatabase());
    const entry = await repo.upsert(PROFILE_A, "测试导入");
    expect(entry.source).toBe("测试导入");
    expect(entry.profile.palette).toEqual(PROFILE_A.palette);
    expect(await repo.findById(entry.id)).not.toBeNull();
    expect(await repo.findById("missing")).toBeNull();
  });
});
