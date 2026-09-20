import type { RadarRawItem, RadarScoreBreakdown, RadarScoredItem, RadarSourceBucket } from "./types";
import { CURIOSITY_TERMS, HOT_TERMS, RADAR_BUCKET_ITEMS_PER_SOURCE, SCIENCE_TERMS } from "./keywords";

/**
 * 纯打分逻辑（中文科普口径）。
 * 维度：signal 平台热度 / relevance 科普相关 / contentFit 图文适配 / business 讨论度 / recency 新鲜度。
 * 不依赖 node 内建与网络；id 用双 FNV-1a（避免 node:crypto 进客户端构建）。
 */

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
    .replace(/&(mdash|ndash|hellip|middot|times|deg|ldquo|rdquo|lsquo|rsquo|laquo|raquo);/g, (_, name: string) => NAMED_ENTITIES[name] ?? "")
    .replace(/&amp;/g, "&")
    .trim();
}

/** 搜狗摘要里高频出现的命名实体（&mdash;&mdash; 等，真机诊断发现） */
const NAMED_ENTITIES: Record<string, string> = {
  mdash: "——",
  ndash: "–",
  hellip: "…",
  middot: "·",
  times: "×",
  deg: "°",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  laquo: "《",
  raquo: "》"
};

/** 去注释 + 去标签 + 实体解码 + 压缩空白（搜狗标题里带 <!--red_beg--> 注释，真机踩过） */
export function cleanText(input = ""): string {
  return decodeEntities(
    String(input)
      // HTML 注释是元数据，替换为空串（换成空格会在 <em>科普</em> 里留下「【 科普 】」式的夹空）
      .replace(/<!--[\s\S]*?-->/g, "")
      // 内联标记（搜狗高亮 <em> 等）直接删除：换成空格会把「【科普】」拆成「【 科普 】」
      .replace(/<\/?(em|b|i|strong|span|u|s|mark|small|sub|sup)\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
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

function buildAngles(item: RadarRawItem, scienceHits: string[], curiosityHits: string[]): string[] {
  const out: string[] = [];
  if (curiosityHits.length) out.push("设问式开头：把标题的疑问做成冷开场");
  if (scienceHits.length) out.push("硬核原理拆解：现象 → 背后机制");
  if (item.source.includes("知乎")) out.push("回答体结构：先给结论再展开论证");
  if (item.source.includes("B站")) out.push("热门视频改编图文：逐帧截图做图解");
  if (item.source.includes("公众号")) out.push("同行选题对标：换个案例讲同一原理");
  out.push("小红书卡片：一图讲清一个知识点");
  return [...new Set(out)].slice(0, 4);
}

function recommend(score: number, scienceHits: string[]): string {
  if (score >= 75 && scienceHits.length) return "公众号深度科普";
  if (score >= 65) return "选题池：优先拆解";
  if (score >= 55) return "快讯/素材池追踪";
  return "观察名单";
}

function listHits(label: string, hits: string[], max = 3): string {
  return hits.length ? `${label}：${hits.slice(0, max).join("、")}` : "";
}

export function scoreItem(item: RadarRawItem, nowMs = Date.now()): RadarScoredItem {
  const text = `${item.title} ${item.summary}`;
  const scienceHits = keywordHits(text, SCIENCE_TERMS);
  const curiosityHits = keywordHits(text, CURIOSITY_TERMS);
  const hotHits = keywordHits(text, HOT_TERMS);
  const isQuestion = /[?？]|吗[。！!]?$|呢[。！!]?$/.test(item.title.trim());

  const signal = Math.min(25, item.rawSignal || 8);
  const relevance = Math.min(25, scienceHits.length * 5 + curiosityHits.length * 3);
  const contentFit = Math.min(20, 5 + (isQuestion ? 4 : 0) + (scienceHits.length ? 5 : 0) + (curiosityHits.length ? 3 : 0) + (/\d/.test(item.title) ? 2 : 0));
  const business = Math.min(20, 6 + curiosityHits.length * 3 + hotHits.length * 2 + (isQuestion ? 2 : 0));
  const recency = Math.max(0, Math.min(10, 10 - daysOld(item.publishedAt, nowMs) * 0.7));
  const rawScore = Math.max(0, Math.min(100, signal + relevance + contentFit + business + recency));
  // 科普相关度必须是主导因子：没有任何科普词命中的全民热点（体育/影视/八卦）即使热榜高热度
  // 也压到 52 分顶（快讯档），不能排在真科普选题前面（真机首跑男篮/教父霸榜踩过）。
  const score = scienceHits.length ? rawScore : Math.min(rawScore, 52);

  const tags = [...new Set([...scienceHits, ...curiosityHits, ...hotHits])].slice(0, 8);
  const angles = buildAngles(item, scienceHits, curiosityHits);
  const recommendation = recommend(score, scienceHits);
  const reasonParts = [
    `${item.source} 信号强度 ${Math.round(signal)}/25`,
    listHits("科普关键词", scienceHits),
    listHits("好奇结构", curiosityHits),
    isQuestion ? "标题本身是设问" : ""
  ].filter(Boolean);
  const selectionReason = `入选原因：${reasonParts.slice(0, 4).join("；")}。`;
  const nextAction =
    score >= 75 && scienceHits.length
      ? "建议：先核验信息源（论文/官方通报/权威媒体），拆成「现象 → 原理 → 生活应用」三段结构，再决定是否开写深度文。"
      : score >= 65
        ? "建议：放入选题池，先花 15 分钟查证事实与数据来源，确认科普角度没有失实风险再拆大纲。"
        : score >= 55
          ? "建议：先放入素材池追踪 24-48 小时，看热度是否持续、评论区是否有高频疑问可回答。"
          : "建议：暂不投入写作，保留为观察名单；若后续讨论升温或有权威解读出现再升级。";

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
    tags: tags.length ? tags : ["热点"],
    angles,
    recommendation,
    selectionReason,
    nextAction
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
