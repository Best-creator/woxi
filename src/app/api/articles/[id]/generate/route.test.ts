// @vitest-environment node

import { describe, expect, it } from "vitest";
import { POST } from "./route";

// 旧端点已退役：工作台只通过 /content/* 生成正文，这里只保证兼容期返回明确的 410。
describe("legacy article generation route", () => {
  it("returns 410 and points at the staged content API", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "请使用分阶段纲要与正文生成接口"
    });
  });
});
