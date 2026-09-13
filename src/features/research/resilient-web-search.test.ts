import { describe, expect, it } from "vitest";
import { ResilientWebSearch } from "./resilient-web-search";
import { ResearchError } from "./errors";
import type { WebSearchPort } from "./types";

const result = { title: "t", url: "https://example.com", snippet: "s" };

function failingPort(): WebSearchPort {
  return {
    search: async () => {
      throw new ResearchError("search_unavailable", "不可用");
    }
  };
}

describe("ResilientWebSearch", () => {
  it("主搜索成功时直接返回", async () => {
    const fallback = { search: async () => [result] };
    const primary = { search: async () => [{ ...result, title: "primary" }] };
    const search = new ResilientWebSearch(primary, fallback);
    const results = await search.search("q", 8);
    expect(results[0].title).toBe("primary");
  });

  it("主搜索抛错时落到兜底", async () => {
    const fallback = { search: async () => [{ ...result, title: "fallback" }] };
    const search = new ResilientWebSearch(failingPort(), fallback);
    const results = await search.search("q", 8);
    expect(results[0].title).toBe("fallback");
  });

  it("主搜索返回空数组时落到兜底", async () => {
    const fallback = { search: async () => [{ ...result, title: "fallback" }] };
    const search = new ResilientWebSearch({ search: async () => [] }, fallback);
    const results = await search.search("q", 8);
    expect(results[0].title).toBe("fallback");
  });

  it("主搜索失败且无兜底时返回空数组", async () => {
    const search = new ResilientWebSearch(failingPort());
    await expect(search.search("q", 8)).resolves.toEqual([]);
  });
});
