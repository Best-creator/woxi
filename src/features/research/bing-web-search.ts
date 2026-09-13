import type { WebSearchResult, WebSearchPort } from "./types";
import { ResearchError } from "./errors";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeXmlEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlEntities(match[1]) : "";
}

/**
 * 从 Bing 的 RSS 搜索结果（&format=rss）提取条目。
 * 注意：该端点对长查询会降级，仅适合短关键词；作为搜狗不可用时的兜底。
 */
export function parseBingRss(xml: string, limit: number): WebSearchResult[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const results: WebSearchResult[] = [];
  for (const item of items) {
    const title = extractTag(item, "title");
    const url = extractTag(item, "link");
    if (!title || !url) continue;
    results.push({
      title,
      url,
      snippet: extractTag(item, "description").slice(0, 400)
    });
    if (results.length >= limit) break;
  }
  return results;
}

export class BingWebSearch implements WebSearchPort {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 12_000
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${Math.min(Math.max(limit, 1), 20)}`,
        {
          headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9" },
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
    } catch {
      throw new ResearchError("search_unavailable", "联网搜索暂时不可用，请稍后重试。");
    }
    if (!response.ok) {
      throw new ResearchError("search_unavailable", "联网搜索暂时不可用，请稍后重试。");
    }
    const xml = await response.text();
    const results = parseBingRss(xml, limit);
    if (!results.length) {
      throw new ResearchError("search_unavailable", "联网搜索没有返回结果。");
    }
    return results;
  }
}
