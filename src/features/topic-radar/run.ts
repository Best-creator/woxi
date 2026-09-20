import type { RadarData, RadarScoredItem, TopicRadarSnapshot } from "./types";
import { RADAR_MAX_ITEMS, RADAR_MIN_SCORE, RADAR_OPPORTUNITY_LIMIT, RADAR_TOP_ITEMS } from "./keywords";
import { buildSourceBuckets, scoreItem, uniqueByUrl } from "./scoring";
import { fetchBuzzingSources, fetchDevto, fetchGithubRepos, fetchHackerNews, fetchHuggingFace, fetchProductHuntRss, scrapeAihot } from "./sources";

/**
 * 汇总编排 + 模块级缓存（原 fetch-radar.mjs 的 main()，输出目标从 latest.json 改为 API 响应）。
 * 缓存 30 分钟；抓到 0 条不缓存（多半是网络受限，下次请求立即重试）；并发请求共享同一次在途抓取。
 */

export const CACHE_TTL_MS = 30 * 60 * 1000;

/** 并行跑七路来源；每路内部已隔离失败（失败 = 空数组），本函数不会 reject */
export async function collectTopicRadar(fetchFn: typeof fetch = fetch, now = new Date()): Promise<RadarData> {
  const sources = await Promise.all([
    scrapeAihot(fetchFn),
    fetchBuzzingSources(fetchFn),
    fetchProductHuntRss(fetchFn),
    fetchHackerNews(fetchFn),
    fetchGithubRepos(fetchFn),
    fetchHuggingFace(fetchFn),
    fetchDevto(fetchFn)
  ]);

  const merged = uniqueByUrl(sources.flat())
    .map((item) => scoreItem(item, now.getTime()))
    .filter((item) => item.score >= RADAR_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, RADAR_MAX_ITEMS);

  return buildRadarData(merged, now);
}

function buildRadarData(merged: RadarScoredItem[], now: Date): RadarData {
  const topItems = merged.slice(0, RADAR_TOP_ITEMS);
  const opportunityItems = merged.filter((item) => item.opportunity).slice(0, RADAR_OPPORTUNITY_LIMIT);
  const byAction: Record<string, RadarScoredItem[]> = {};
  const sourceStats: Record<string, number> = {};
  for (const item of merged) {
    (byAction[item.recommendation] ??= []).push(item);
    sourceStats[item.source] = (sourceStats[item.source] || 0) + 1;
  }
  return {
    generatedAt: now.toISOString(),
    sourceCount: Object.keys(sourceStats).length,
    itemCount: merged.length,
    topItems,
    opportunityItems,
    byAction,
    sourceStats,
    bySource: buildSourceBuckets(merged)
  };
}

interface CacheEntry {
  data: RadarData;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<RadarData> | null = null;

export async function getTopicRadar(options: { refresh?: boolean; fetchFn?: typeof fetch } = {}): Promise<TopicRadarSnapshot> {
  const { refresh = false, fetchFn = fetch } = options;
  if (!refresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { data: cache.data, cachedAt: new Date(cache.fetchedAt).toISOString(), fresh: false };
  }
  if (!inFlight) {
    inFlight = collectTopicRadar(fetchFn)
      .then((data) => {
        // 0 条说明网络整体不可用：不写缓存，下一次请求直接重试
        if (data.itemCount > 0) cache = { data, fetchedAt: Date.now() };
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  const data = await inFlight;
  return {
    data,
    cachedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
    fresh: true
  };
}
