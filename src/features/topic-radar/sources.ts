import type { RadarFeedEntry, RadarRawItem } from "./types";
import { AIHOT_URL, BUZZING_RSS_SOURCES, PRODUCT_HUNT_RSS_URL, RADAR_COMPLAINT_CONTEXT_TERMS, RADAR_HOT_TERMS, RADAR_KEYWORDS } from "./keywords";
import { cleanText, detectOpportunitySignals } from "./scoring";
import { parseRadarFeed } from "./rss";

/**
 * 七路信号源抓取（移植自「选题雷达」fetch-radar.mjs）。
 * - rss-parser → parseRadarFeed（rss.ts）
 * - cheerio → extractHtmlLinks 正则抽取
 * - 每个来源独立 try/catch：单源失败 console.warn 后返回 []，绝不拖垮整轮汇总。
 * - fetchFn 一律可注入，测试用桩替代真实网络。
 */

const USER_AGENT = "Mozilla/5.0 topic-radar/0.1 (wo-xi hot-topic radar)";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,application/rss+xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

/** AIHOT 首页链接抽取（原 cheerio scrapeLinks 的正则版，纯函数可测） */
export function extractHtmlLinks(source: string, html: string, baseUrl: string, limit = 120, now = new Date()): RadarRawItem[] {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const items: RadarRawItem[] = [];
  for (const anchor of anchors) {
    if (items.length >= limit) break;
    const hrefMatch = anchor.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? "") : "";
    // Next.js 等 SSR 页面的 <a> 里可能嵌着内联脚本/样式碎片，先剔除再取文本，
    // 否则 self.__next_f.push 之类会被当成标题（真机踩过）。
    const inner = anchor
      .replace(/<a\b[^>]*>/i, "")
      .replace(/<\/a>/i, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
    const title = cleanText(inner);
    if (!title || title.length < 8 || !href) continue;
    let full: string;
    try {
      full = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (full.includes("javascript:") || full.includes("#")) continue;
    items.push({
      title,
      url: full,
      source,
      summary: title,
      publishedAt: now.toISOString(),
      rawSignal: 8
    });
  }
  return items;
}

export async function scrapeAihot(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  try {
    const html = await fetchText(AIHOT_URL, fetchFn);
    return extractHtmlLinks("AIHOT", html, AIHOT_URL);
  } catch (error) {
    console.warn(`topic-radar source failed: AIHOT: ${describeError(error)}`);
    return [];
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 通用 RSS 源（原 fetchRSS） */
export async function fetchRssSource(fetchFn: typeof fetch, source: string, url: string, limit = 40, rawSignal = 12): Promise<RadarRawItem[]> {
  try {
    const xml = await fetchText(url, fetchFn);
    return parseRadarFeed(xml)
      .slice(0, limit)
      .map((entry) => mapFeedEntry(source, entry, rawSignal))
      .filter((item): item is RadarRawItem => item !== null);
  } catch (error) {
    console.warn(`topic-radar rss failed: ${source}: ${describeError(error)}`);
    return [];
  }
}

function mapFeedEntry(source: string, entry: RadarFeedEntry, rawSignal: number, limitSummary = 260): RadarRawItem | null {
  const title = cleanText(entry.title);
  if (!title || !entry.link) return null;
  return {
    title,
    url: entry.link,
    source,
    summary: cleanText(entry.contentSnippet || entry.title).slice(0, limitSummary),
    publishedAt: entry.isoDate || new Date().toISOString(),
    rawSignal
  };
}

/** Buzzing 条目的相关性过滤（原 isRelevantBuzzingItem） */
function isRelevantBuzzingItem(text: string, source = ""): boolean {
  const aiHits = keywordHits(text, RADAR_KEYWORDS.ai);
  const saasHits = keywordHits(text, RADAR_KEYWORDS.saas);
  const indieHits = keywordHits(text, RADAR_KEYWORDS.indie);
  const hotHits = keywordHits(text, RADAR_HOT_TERMS);
  const opportunity = detectOpportunitySignals(text);
  const sourceBoost = /Product Hunt|Show HN|SideProject|HN Ask|Dev\.to/i.test(source);
  return Boolean(
    aiHits.length ||
      saasHits.length ||
      indieHits.length ||
      hotHits.length >= 2 ||
      opportunity.hasComplaint ||
      (sourceBoost &&
        (keywordHits(text, RADAR_COMPLAINT_CONTEXT_TERMS).length ||
          /build|built|launch|tool|app|product|startup|项目|产品|工具|开发/i.test(text)))
  );
}

function keywordHits(text: string, list: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return list.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

/** Buzzing 中转 RSS 映射（原 mapBuzzingFeedItems；相关条目信号更高，吐槽条目再抬高） */
export function mapBuzzingFeedItems(source: string, feedItems: RadarFeedEntry[] = [], limit = 40): RadarRawItem[] {
  return (feedItems || [])
    .slice(0, limit)
    .map((entry) => {
      const title = cleanText(entry.title);
      const summary = cleanText(entry.contentSnippet || entry.title).slice(0, 280);
      const text = `${title} ${summary}`;
      if (!title || !entry.link || !isRelevantBuzzingItem(text, source)) return null;
      const opportunity = detectOpportunitySignals(text);
      return mapFeedEntry(source, { ...entry, title, contentSnippet: summary }, opportunity.hasComplaint ? 16 : 13, 280);
    })
    .filter((item): item is RadarRawItem => item !== null);
}

export async function fetchBuzzingSources(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  const batches = await Promise.all(
    BUZZING_RSS_SOURCES.map(async ([source, url, limit]) => {
      try {
        const xml = await fetchText(url, fetchFn);
        return mapBuzzingFeedItems(source, parseRadarFeed(xml), limit);
      } catch (error) {
        console.warn(`topic-radar buzzing rss failed: ${source}: ${describeError(error)}`);
        return [];
      }
    })
  );
  return batches.flat();
}

export async function fetchHackerNews(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  const queries = ["AI SaaS", "AI agent", "automation startup", "indie hacker", "LLM workflow", "browser agent", "micro SaaS"];
  const all: RadarRawItem[] = [];
  for (const query of queries) {
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`;
      const json = JSON.parse(await fetchText(url, fetchFn)) as {
        hits?: Array<{ title?: string; url?: string | null; objectID?: string; created_at?: string; points?: number; num_comments?: number }>;
      };
      for (const hit of json.hits || []) {
        all.push({
          title: cleanText(hit.title ?? ""),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: "Hacker News",
          summary: cleanText(hit.title ?? ""),
          publishedAt: hit.created_at ?? new Date().toISOString(),
          rawSignal: Math.min(30, 8 + (hit.points || 0) / 12 + (hit.num_comments || 0) / 8)
        });
      }
    } catch (error) {
      console.warn(`topic-radar HN failed ${query}: ${describeError(error)}`);
    }
  }
  return all.filter((item) => item.title && item.url);
}

export async function fetchGithubRepos(fetchFn: typeof fetch, now = new Date()): Promise<RadarRawItem[]> {
  const since = new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10);
  const queries = [
    `ai agent created:>${since} stars:>30`,
    `llm automation created:>${since} stars:>20`,
    `saas boilerplate created:>${since} stars:>20`,
    `mcp server created:>${since} stars:>15`
  ];
  const all: RadarRawItem[] = [];
  for (const query of queries) {
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`;
      const json = JSON.parse(await fetchText(url, fetchFn)) as {
        items?: Array<{ full_name?: string; stargazers_count?: number; html_url?: string; description?: string; created_at?: string; updated_at?: string }>;
      };
      for (const repo of json.items || []) {
        all.push({
          title: `${repo.full_name} ★${repo.stargazers_count}`,
          url: repo.html_url ?? "",
          source: "GitHub Trending Search",
          summary: cleanText(repo.description || repo.full_name || ""),
          publishedAt: repo.created_at || repo.updated_at || now.toISOString(),
          rawSignal: Math.min(35, 10 + Math.log10((repo.stargazers_count || 0) + 1) * 8)
        });
      }
    } catch (error) {
      console.warn(`topic-radar GitHub failed ${query}: ${describeError(error)}`);
    }
  }
  return all.filter((item) => item.title && item.url);
}

/** HF 模型映射（原 mapHuggingFaceModels，纯函数可测） */
export function mapHuggingFaceModels(models: Array<Record<string, unknown>> = []): RadarRawItem[] {
  return models
    .map((model) => {
      const id = (model.modelId || model.id) as string | undefined;
      if (!id) return null;
      const tags = Array.isArray(model.tags) ? (model.tags as string[]).slice(0, 8) : [];
      const pipeline = (model.pipeline_tag || model.pipelineTag || "model") as string;
      const likes = Number(model.likes || 0);
      const downloads = Number(model.downloads || 0);
      const signal = Math.min(32, 9 + Math.log10(likes + 1) * 5 + Math.log10(downloads + 1) * 3);
      const tagText = tags.length ? tags.join(", ") : pipeline;
      return {
        title: `${id} ❤${likes}`,
        url: `https://huggingface.co/${id}`,
        source: "Hugging Face Models",
        summary: `${pipeline}: ${tagText}`,
        publishedAt: ((model.lastModified || model.createdAt || model.updatedAt) as string | undefined) ?? new Date().toISOString(),
        rawSignal: signal
      };
    })
    .filter((item): item is RadarRawItem => item !== null);
}

export async function fetchHuggingFace(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  try {
    const url = "https://huggingface.co/api/models?sort=likes&direction=-1&limit=40&full=false";
    const json = JSON.parse(await fetchText(url, fetchFn)) as Array<Record<string, unknown>>;
    return mapHuggingFaceModels(Array.isArray(json) ? json : []);
  } catch (error) {
    console.warn(`topic-radar Hugging Face failed: ${describeError(error)}`);
    return [];
  }
}

export async function fetchDevto(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  const tags = ["ai", "saas", "startup", "productivity", "webdev"];
  const all: RadarRawItem[] = [];
  for (const tag of tags) {
    try {
      const json = JSON.parse(await fetchText(`https://dev.to/api/articles?tag=${tag}&top=7&per_page=20`, fetchFn)) as Array<{
        title?: string;
        url?: string;
        description?: string;
        published_at?: string;
        public_reactions_count?: number;
        comments_count?: number;
      }>;
      for (const article of json || []) {
        all.push({
          title: cleanText(article.title ?? ""),
          url: article.url ?? "",
          source: "Dev.to",
          summary: cleanText(article.description || article.title || ""),
          publishedAt: article.published_at ?? new Date().toISOString(),
          rawSignal: Math.min(28, 8 + (article.public_reactions_count || 0) / 5 + (article.comments_count || 0))
        });
      }
    } catch (error) {
      console.warn(`topic-radar Dev.to failed ${tag}: ${describeError(error)}`);
    }
  }
  return all.filter((item) => item.title && item.url);
}

export async function fetchProductHuntRss(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  return fetchRssSource(fetchFn, "Product Hunt RSS", PRODUCT_HUNT_RSS_URL);
}
