import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  DEFAULT_AUDIENCE_ID,
  describeAudience,
  isAudienceId,
  resolveAudience,
  type AudienceId
} from "./audience";

describe("audience", () => {
  it("keeps the historical default wording byte-for-byte", () => {
    // 老文章重跑生成时不该因为这次改动改变提示词，否则结果会无声漂移。
    expect(DEFAULT_AUDIENCE_ID).toBe("general_beginner");
    expect(describeAudience(DEFAULT_AUDIENCE_ID)).toBe("对该知识点零基础的普通读者");
  });

  it("falls back to the default audience for legacy or unknown values", () => {
    for (const value of [undefined, null, "", "office-slacker", 42, {}]) {
      expect(resolveAudience(value)).toBe(DEFAULT_AUDIENCE_ID);
    }
  });

  it("accepts every declared audience id", () => {
    for (const id of Object.keys(AUDIENCES) as AudienceId[]) {
      expect(isAudienceId(id)).toBe(true);
      expect(resolveAudience(id)).toBe(id);
      expect(AUDIENCE_LABELS[id]).toBeTruthy();
    }
  });

  it("describes each audience with a self-contained prompt", () => {
    const prompts = Object.values(AUDIENCES).map((audience) => audience.prompt);

    expect(new Set(prompts).size).toBe(prompts.length);
    // 默认受众要保持历史原文（只有 13 字），新增受众必须自带兴趣、痛点和禁忌。
    for (const id of ["office_desk", "senior_reader"] as const) {
      expect(AUDIENCES[id].prompt.length).toBeGreaterThan(40);
      expect(AUDIENCES[id].prompt).toMatch(/禁止/);
    }
  });

  it("names the pain points the two extra audiences were added for", () => {
    expect(AUDIENCES.office_desk.prompt).toContain("久坐");
    expect(AUDIENCES.office_desk.prompt).toContain("说教");
    expect(AUDIENCES.senior_reader.prompt).toContain("恐慌");
    expect(AUDIENCES.senior_reader.label).toBe("中老年读者");
  });
});
