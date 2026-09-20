import type { RadarData, RadarScoredItem, TopicRadarSnapshot } from "./types";
import { RADAR_MAX_ITEMS, RADAR_MIN_SCORE, RADAR_TOP_ITEMS } from "./keywords";
import { buildSourceBuckets, scoreItem, uniqueByUrl } from "./scoring";
import { fetchBilibiliPopular, fetchSogouWeixin, fetchZhihuHot } from "./sources";

/**
 * 汇总编排 + 模块级缓存。
 * 三路中文科普源并行跑（搜狗内部串行 5 个关键词并自带停顿）；每路内部已隔离失败（失败 = 空数组）。
 * 缓存 30 分钟（对搜狗风控友好）；抓到 0 条不缓存（下次请求立即重试）；并发请求共享同一次在途抓取。
 */

export const CACHE_TTL_MS = 30 * 60 * 1000;

/** 并行跑三路来源；本函数不会 reject。pause 供测试注入即时停顿（搜狗关键词间节流用） */
export async function collectTopicRadar(
  fetchFn: typeof fetch = fetch,
  now = new Date(),
  options: { pause?: (ms: number) => Promise<void> } = {}
): Promise<RadarData> {
  const sources = await Promise.all([
    fetchZhihuHot(fetchFn, now),
    fetchBilibiliPopular(fetchFn),
    fetchSogouWeixin(fetchFn, { now, pause: options.pause })
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

export async function getTopicRadar(options: { refresh?: boolean; fetchFn?: typeof fetch; pause?: (ms: number) => Promise<void> } = {}): Promise<TopicRadarSnapshot> {
  const { refresh = false, fetchFn = fetch, pause } = options;
  if (!refresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { data: cache.data, cachedAt: new Date(cache.fetchedAt).toISOString(), fresh: false };
  }
  if (!inFlight) {
    inFlight = collectTopicRadar(fetchFn, new Date(), { pause })
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
