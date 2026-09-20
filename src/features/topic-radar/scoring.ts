import type { RadarOpportunity, RadarRawItem, RadarScoreBreakdown, RadarScoredItem, RadarSourceBucket } from "./types";
import { RADAR_BUCKET_ITEMS_PER_SOURCE, RADAR_COMPLAINT_CONTEXT_TERMS, RADAR_COMPLAINT_TERMS, RADAR_HOT_TERMS, RADAR_KEYWORDS } from "./keywords";

/**
 * 纯打分逻辑，与「选题雷达」fetch-radar.mjs 的 scoreItem 同构。
 * 不依赖 node 内建与网络，可单独测试；ID 哈希用双 FNV-1a 替代原 sha1（避免 node:crypto 进客户端构建）。
 */

const KEYWORD_GROUPS = {
  ai: RADAR_KEYWORDS.ai as readonly string[],
  saas: RADAR_KEYWORDS.saas as readonly string[],
  indie: RADAR_KEYWORDS.indie as readonly string[],
  cnContent: RADAR_KEYWORDS.cnContent as readonly string[]
};

/** HTML/XML 实体解码（&amp; 最后替换防止二次解码；数字实体安全兜底） */
export function decodeEntities(text: string): string {
  const numeric = (body: string, radix: 10 | 16) => {
    try {
      const code = parseInt(body, radix);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  };
  return text
    .replace(/&#(\d+);/g, (_, body: string) => numeric(body, 10))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, body: string) => numeric(body, 16))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/** 去标签 + 实体解码 + 压缩空白（对应原实现 clean() + cheerio .text() 的实体解码行为） */
export function cleanText(input = ""): string {
  return decodeEntities(String(input).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function keywordHits(text: string, list: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return list.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

/** 条目年龄（天）；缺失或无法解析按 14 天（recency 记 0 分）处理 */
export function daysOld(publishedAt: string, nowMs = Date.now()): number {
  if (!publishedAt) return 14;
  const time = new Date(publishedAt).getTime();
  if (Number.isNaN(time)) return 14;
  return Math.max(0, (nowMs - time) / 86_400_000);
}

export function detectOpportunitySignals(text = ""): {
  hasComplaint: boolean;
  complaintHits: string[];
  contextHits: string[];
} {
  const complaintHits = keywordHits(text, RADAR_COMPLAINT_TERMS);
  const contextHits = keywordHits(text, RADAR_COMPLAINT_CONTEXT_TERMS);
  return {
    hasComplaint: complaintHits.length > 0 && (contextHits.length > 0 || /tell hn|ask hn|sideproject|product hunt|saas|tool|app/i.test(text)),
    complaintHits,
    contextHits
  };
}

/** 双 FNV-1a 拼 16 位 hex；去重靠 URL（uniqueByUrl），id 只做展示 key 用 */
function hashId(input: string): string {
  const fnv = (seed: number) => {
    let hash = seed;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x01000193);
}

/** URL 去重（去掉查询串后比对，title 兜底） */
export function uniqueByUrl<T extends { title: string; url?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = (item.url || item.title).replace(/\?.*$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildAngles(item: RadarRawItem, hits: {
  aiHits: string[];
  saasHits: string[];
  indieHits: string[];
  hotHits: string[];
  opportunity?: RadarOpportunity;
}): string[] {
  const out: string[] = [];
  if (hits.opportunity) out.push("用户吐槽 → 开发机会");
  if (hits.aiHits.length) out.push("AI 工具/工作流拆解");
  if (hits.saasHits.length) out.push("海外 SaaS 产品机会");
  if (hits.indieHits.length) out.push("独立开发者/增长案例");
  if (hits.hotHits.includes("mcp")) out.push("MCP 生态应用清单");
  if (hits.hotHits.includes("coding")) out.push("AI 编程提效实测");
  if (hits.hotHits.includes("browser")) out.push("浏览器 Agent 场景");
  out.push("小红书卡片：痛点-工具-结果");
  return [...new Set(out)].slice(0, 4);
}

function recommend(item: RadarRawItem, score: number, hits: {
  aiHits: string[];
  saasHits: string[];
  indieHits: string[];
  opportunity?: RadarOpportunity;
}): string {
  if (hits.opportunity) return "用户吐槽/开发机会";
  if (score >= 70 && hits.saasHits.length) return "公众号深度文 + SaaS 机会评估";
  if (score >= 65 && hits.aiHits.length) return "小红书工具卡 + 实测教程";
  if (hits.indieHits.length) return "独立开发案例库";
  if (score >= 55) return "快讯/素材池追踪";
  return "观察名单";
}

function listHits(label: string, hits: string[], max = 3): string {
  return hits.length ? `${label}：${hits.slice(0, max).join("、")}` : "";
}

function buildSelectionReason(
  item: RadarRawItem,
  hits: {
    signal: number;
    aiHits: string[];
    saasHits: string[];
    indieHits: string[];
    contentHits: string[];
    hotHits: string[];
    opportunity?: RadarOpportunity;
  }
): string {
  const parts = [
    `来源 ${item.source} 的信号强度 ${Math.round(hits.signal)}/25`,
    hits.opportunity ? `用户负反馈：${hits.opportunity.complaintHits.slice(0, 3).join("、")}` : "",
    listHits("AI/工具关键词", hits.aiHits),
    listHits("SaaS/商业关键词", hits.saasHits),
    listHits("独立开发/增长关键词", hits.indieHits),
    listHits("内容适配关键词", hits.contentHits),
    listHits("热点场景", hits.hotHits)
  ].filter(Boolean);
  return `入选原因：${parts.slice(0, 4).join("；")}。`;
}

function buildNextAction(
  item: RadarRawItem,
  score: number,
  hits: {
    aiHits: string[];
    saasHits: string[];
    indieHits: string[];
    contentHits: string[];
    hotHits: string[];
    opportunity?: RadarOpportunity;
  },
  recommendation: string
): string {
  if (hits.opportunity) {
    return "建议：把这条负反馈当作开发机会处理，先追原帖评论确认高频痛点，再拆 MVP 替代方案：目标用户、现有 SaaS 不好用点、愿付费场景、可 1 周验证的最小功能。";
  }
  if (recommendation.includes("公众号深度文")) {
    return "建议：先做 30 分钟资料核验，拆成“痛点 → 现有方案 → 商业化机会 → 可复制工作流”，再决定是否写公众号深度文。";
  }
  if (recommendation.includes("小红书")) {
    return "建议：做一张小红书卡片，标题突出具体人群和结果；同时找 2-3 个同类工具做实测对比。";
  }
  if (recommendation.includes("独立开发")) {
    return "建议：加入案例库，补充创始人、定价、获客渠道和 MRR/增长线索，用作后续选题或产品机会素材。";
  }
  if (score >= 55 || hits.hotHits.length) {
    return "建议：先放入素材池追踪 24-48 小时，观察是否有二次传播、竞品跟进或用户评论痛点。";
  }
  return "建议：暂不投入写作，只保留为观察名单；如果后续出现更多讨论或真实用户案例再升级。";
}

export function scoreItem(item: RadarRawItem, nowMs = Date.now()): RadarScoredItem {
  const text = `${item.title} ${item.summary}`;
  const aiHits = keywordHits(text, KEYWORD_GROUPS.ai);
  const saasHits = keywordHits(text, KEYWORD_GROUPS.saas);
  const indieHits = keywordHits(text, KEYWORD_GROUPS.indie);
  const contentHits = keywordHits(text, KEYWORD_GROUPS.cnContent);
  const hotHits = keywordHits(text, RADAR_HOT_TERMS);
  const opportunitySignals = detectOpportunitySignals(text);
  const complaintBoost = opportunitySignals.hasComplaint ? 8 : 0;
  const signal = Math.min(25, (item.rawSignal || 8) + (opportunitySignals.hasComplaint ? 3 : 0));
  const relevance = Math.min(25, aiHits.length * 4 + saasHits.length * 4 + indieHits.length * 3 + hotHits.length * 2 + (opportunitySignals.hasComplaint ? 4 : 0));
  const contentFit = Math.min(20, 5 + contentHits.length * 3 + (aiHits.length ? 5 : 0) + (hotHits.length ? 4 : 0) + (opportunitySignals.hasComplaint ? 4 : 0));
  const business = Math.min(20, 4 + saasHits.length * 4 + indieHits.length * 3 + (text.toLowerCase().includes("api") ? 3 : 0) + (text.toLowerCase().includes("workflow") ? 3 : 0) + complaintBoost);
  const recency = Math.max(0, Math.min(10, 10 - daysOld(item.publishedAt, nowMs) * 0.7));
  const score = Math.max(0, Math.min(100, signal + relevance + contentFit + business + recency));
  const opportunity: RadarOpportunity | undefined = opportunitySignals.hasComplaint
    ? {
        type: "用户吐槽/开发机会",
        complaintHits: opportunitySignals.complaintHits.slice(0, 5),
        contextHits: opportunitySignals.contextHits.slice(0, 5)
      }
    : undefined;
  const tags = [...new Set([...aiHits, ...saasHits, ...indieHits, ...contentHits, ...hotHits, ...(opportunity ? ["用户吐槽", "开发机会"] : [])])].slice(0, 10);
  const angles = buildAngles(item, { aiHits, saasHits, indieHits, hotHits, opportunity });
  const recommendation = recommend(item, score, { aiHits, saasHits, indieHits, opportunity });
  const selectionReason = buildSelectionReason(item, { signal, aiHits, saasHits, indieHits, contentHits, hotHits, opportunity });
  const nextAction = buildNextAction(item, Math.round(score), { aiHits, saasHits, indieHits, contentHits, hotHits, opportunity }, recommendation);
  const scoreBreakdown: RadarScoreBreakdown = {
    signal: Math.round(signal),
    relevance: Math.round(relevance),
    contentFit: Math.round(contentFit),
    business: Math.round(business),
    recency: Math.round(recency)
  };
  return {
    ...item,
    id: hashId(item.url || item.title),
    score: Math.round(score),
    scoreBreakdown,
    tags: tags.length ? tags : ["trend"],
    angles,
    recommendation,
    selectionReason,
    nextAction,
    opportunity
  };
}

/** 按来源分桶，桶内按分排序后截断 */
export function buildSourceBuckets(items: RadarScoredItem[] = [], limitPerSource = RADAR_BUCKET_ITEMS_PER_SOURCE): RadarSourceBucket[] {
  const grouped = new Map<string, RadarScoredItem[]>();
  for (const item of items) {
    const source = item.source || "Unknown";
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source)!.push(item);
  }
  return [...grouped.entries()]
    .map(([source, sourceItems]) => ({
      source,
      count: sourceItems.length,
      averageScore: Math.round(sourceItems.reduce((sum, item) => sum + (item.score || 0), 0) / sourceItems.length),
      items: sourceItems.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limitPerSource)
    }))
    .sort((a, b) => b.count - a.count || b.averageScore - a.averageScore || a.source.localeCompare(b.source));
}
