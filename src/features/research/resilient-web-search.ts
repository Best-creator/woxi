import type { WebSearchPort } from "./types";

/**
 * 先走主搜索（搜狗），失败时兜底到备用搜索（Bing RSS）。
 */
export class ResilientWebSearch implements WebSearchPort {
  constructor(
    private readonly primary: WebSearchPort,
    private readonly fallback?: WebSearchPort
  ) {}

  async search(query: string, limit: number) {
    try {
      const results = await this.primary.search(query, limit);
      if (results.length > 0) return results;
    } catch {
      // 主搜索失败，落到兜底。
    }
    if (!this.fallback) return [];
    return this.fallback.search(query, limit);
  }
}
