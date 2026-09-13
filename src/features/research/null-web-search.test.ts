import { describe, expect, it } from "vitest";
import { NullWebSearch, isWebSearchDisabled } from "./null-web-search";
import type { WebSearchPort } from "./types";

describe("NullWebSearch", () => {
  it("可作为 WebSearchPort 使用，永远返回空结果", async () => {
    // 通过接口类型调用，同时验证 NullWebSearch 满足端口契约。
    const search: WebSearchPort = new NullWebSearch();
    await expect(search.search("任意查询词", 8)).resolves.toEqual([]);
  });
});

describe("isWebSearchDisabled", () => {
  it("WO_XI_DISABLE_WEB_SEARCH=1 时返回 true", () => {
    expect(isWebSearchDisabled({ WO_XI_DISABLE_WEB_SEARCH: "1" })).toBe(true);
  });

  it("未设置或取其他值时返回 false", () => {
    expect(isWebSearchDisabled({})).toBe(false);
    expect(isWebSearchDisabled({ WO_XI_DISABLE_WEB_SEARCH: "0" })).toBe(false);
    expect(isWebSearchDisabled({ WO_XI_DISABLE_WEB_SEARCH: "true" })).toBe(false);
  });

  it("默认读取 process.env", () => {
    expect(isWebSearchDisabled()).toBe(typeof process.env.WO_XI_DISABLE_WEB_SEARCH === "undefined"
      ? false
      : process.env.WO_XI_DISABLE_WEB_SEARCH === "1");
  });
});
