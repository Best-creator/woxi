import type { WebSearchResult, WebSearchPort } from "./types";
import { ResearchError } from "./errors";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function stripTags(fragment: string) {
  return fragment
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从搜狗搜索结果页提取「标题 + 链接 + 摘要」。
 * 标题在 <h3 class="vr-title..."> 里，摘要在 class 含 "space-txt" 的块里，
 * 两者数量可能不一致（部分结果无摘要），按下标弱配对。
 */
export function parseSogouResults(html: string, limit: number): WebSearchResult[] {
  const titleBlocks = html.match(/<h3 class="vr-title[^"]*"[^>]*>[\s\S]*?<\/h3>/g) ?? [];
  const results: WebSearchResult[] = [];

  for (const block of titleBlocks) {
    const linkMatch = block.match(/href="([^"]+)"/);
    if (!linkMatch) continue;
    const rawUrl = linkMatch[1];
    const url = rawUrl.startsWith("http")
      ? rawUrl
      : `https://www.sogou.com${rawUrl}`;
    const title = stripTags(block);
    if (!title) continue;
    results.push({ title, url, snippet: "" });
    if (results.length >= limit) break;
  }

  const snippetBlocks = html.match(/class="[^"]*space-txt[^"]*"[^>]*>[\s\S]*?<\/p>/g) ?? [];
  snippetBlocks.slice(0, results.length).forEach((block, index) => {
    results[index].snippet = stripTags(block).slice(0, 400);
  });

  return results;
}

export class SogouWebSearch implements WebSearchPort {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 12_000
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
        {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "zh-CN,zh;q=0.9",
            Accept: "text/html"
          },
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
    const html = await response.text();
    return parseSogouResults(html, limit);
  }
}
