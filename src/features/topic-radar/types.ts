/**
 * 选题雷达的数据形状。
 * 2026-09-20 换源：海外开发者源（GitHub/HN/Dev.to/PH/HF）→ 中文科普源（知乎热榜/B站热门/搜狗微信同行文章）。
 */

/** 抓取阶段尚未打分的原始条目 */
export interface RadarRawItem {
  title: string;
  url: string;
  source: string;
  /** 作者/公众号名/UP主（可选，展示在来源旁） */
  author?: string;
  summary: string;
  publishedAt: string;
  rawSignal: number;
}

/** 五维打分明细（合计即 score，0-100） */
export interface RadarScoreBreakdown {
  /** 信号强度：平台热度（榜单排名/播放量/新鲜度） */
  signal: number;
  /** 科普相关度：科普词命中 */
  relevance: number;
  /** 图文适配度：能不能直接做成科普图文 */
  contentFit: number;
  /** 讨论度：好奇结构（设问/争议/求证） */
  business: number;
  /** 新鲜度 */
  recency: number;
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
  byAction: Record<string, RadarScoredItem[]>;
  sourceStats: Record<string, number>;
  bySource: RadarSourceBucket[];
}

/** GET /api/topic-radar 的响应体 */
export interface TopicRadarSnapshot {
  data: RadarData;
  /** 缓存写入时间；null 表示本轮实时抓取且未写入缓存（例如抓到 0 条时不缓存） */
  cachedAt: string | null;
  /** true = 本轮实时抓取；false = 命中缓存 */
  fresh: boolean;
}
