/**
 * 选题雷达的数据形状。
 * 移植自桌面项目「选题雷达」scripts/fetch-radar.mjs，去除 rss-parser / cheerio 依赖后保持同构。
 */

/** 抓取阶段尚未打分的原始条目 */
export interface RadarRawItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  publishedAt: string;
  rawSignal: number;
}

/** 五维打分明细（合计即 score，0-100） */
export interface RadarScoreBreakdown {
  signal: number;
  relevance: number;
  contentFit: number;
  business: number;
  recency: number;
}

/** 用户负反馈信号（吐槽 → 开发机会） */
export interface RadarOpportunity {
  type: "用户吐槽/开发机会";
  complaintHits: string[];
  contextHits: string[];
}

export interface RadarScoredItem extends RadarRawItem {
  id: string;
  score: number;
  scoreBreakdown: RadarScoreBreakdown;
  tags: string[];
  angles: string[];
  recommendation: string;
  selectionReason: string;
  nextAction: string;
  opportunity?: RadarOpportunity;
}

/** 按来源分桶（用于查看每个信号源的命中率） */
export interface RadarSourceBucket {
  source: string;
  count: number;
  averageScore: number;
  items: RadarScoredItem[];
}

export interface RadarData {
  generatedAt: string;
  sourceCount: number;
  itemCount: number;
  topItems: RadarScoredItem[];
  opportunityItems: RadarScoredItem[];
  byAction: Record<string, RadarScoredItem[]>;
  sourceStats: Record<string, number>;
  bySource: RadarSourceBucket[];
}

/** 轻量 RSS 解析产物（rss-parser 的最小替代形状） */
export interface RadarFeedEntry {
  title: string;
  link: string;
  contentSnippet: string;
  isoDate: string;
}

/** GET /api/topic-radar 的响应体 */
export interface TopicRadarSnapshot {
  data: RadarData;
  /** 缓存写入时间；null 表示本轮实时抓取且未写入缓存（例如抓到 0 条时不缓存） */
  cachedAt: string | null;
  /** true = 本轮实时抓取；false = 命中缓存 */
  fresh: boolean;
}
