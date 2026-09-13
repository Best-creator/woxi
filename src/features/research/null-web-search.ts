import type { WebSearchPort } from "./types";

/**
 * 永远返回空结果的搜索适配器。
 *
 * 用途：E2E 测试、离线演示等需要保证零外网请求的环境。
 * 空结果会让 collectWebResearch 以 search_unavailable 结束，
 * 上层（UI / API）已有对应的降级路径。
 */
export class NullWebSearch implements WebSearchPort {
  async search() {
    return [];
  }
}

/**
 * 环境级禁用开关：WO_XI_DISABLE_WEB_SEARCH=1 时 getWebSearch 返回 NullWebSearch。
 * 提成纯函数便于单测，默认读 process.env。
 */
export function isWebSearchDisabled(env: Record<string, string | undefined> = process.env) {
  return env.WO_XI_DISABLE_WEB_SEARCH === "1";
}
