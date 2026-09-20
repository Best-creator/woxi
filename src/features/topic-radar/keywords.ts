/**
 * 选题雷达的关键词与抓取配置（移植自「选题雷达」fetch-radar.mjs，逐条保留）。
 */

/** 相关性关键词组 */
export const RADAR_KEYWORDS = {
  ai: ["ai", "agent", "llm", "gpt", "claude", "gemini", "openai", "copilot", "automation", "workflow", "rag", "voice", "image", "video", "coding"],
  saas: ["saas", "b2b", "crm", "analytics", "dashboard", "api", "subscription", "billing", "workspace", "productivity", "customer", "support"],
  indie: ["indie", "startup", "founder", "side project", "micro saas", "launch", "product hunt", "mrr", "growth"],
  cnContent: ["template", "tool", "tutorial", "case study", "prompt", "no-code", "小红书", "wechat", "content", "marketing", "creator"]
} as const;

/** 热点场景词（命中 ≥2 也算相关） */
export const RADAR_HOT_TERMS = ["agent", "workflow", "automation", "browser", "coding", "voice", "video", "mcp", "rag", "spreadsheet", "notion", "crm", "email", "newsletter", "design", "commerce", "education", "health", "finance"];

/** 吐槽词（负反馈信号） */
export const RADAR_COMPLAINT_TERMS = [
  "complain", "complaint", "painfully hard", "impossible", "broken", "slow", "expensive", "overpriced", "cancel", "locked in", "lock-in", "hate", "terrible", "awful", "frustrating", "doesn't work", "does not work", "buggy", "missing", "hard to use", "poor", "worst", "problem", "issue", "issues", "churn", "替代", "不好用", "太贵", "吐槽", "很难用", "难用", "取消订阅", "无法", "痛苦", "卡顿", "崩溃", "缺少", "问题"
];

/** 吐槽语境词（吐槽词需要落在产品语境里才算数） */
export const RADAR_COMPLAINT_CONTEXT_TERMS = ["saas", "tool", "app", "software", "product", "workflow", "billing", "subscription", "crm", "api", "dashboard", "agent", "ai", "mcp", "automation", "email", "notion", "excel", "spreadsheet", "service", "平台", "工具", "产品", "软件", "订阅", "工作流", "自动化"];

/** Buzzing 中转 RSS 源：[展示名, 地址, 最多取条数] */
export const BUZZING_RSS_SOURCES: ReadonlyArray<readonly [string, string, number]> = [
  ["Buzzing Product Hunt", "https://ph.buzzing.cc/feed.xml", 18],
  ["Buzzing Show HN", "https://showhn.buzzing.cc/feed.xml", 18],
  ["Buzzing SideProject", "https://sideproject.buzzing.cc/feed.xml", 18],
  ["Buzzing HN Front", "https://hnfront.buzzing.cc/feed.xml", 18],
  ["Buzzing HN Ask", "https://askhn.buzzing.cc/feed.xml", 18],
  ["Buzzing Dev.to", "https://dev.buzzing.cc/feed.xml", 18],
  ["Buzzing Lobsters", "https://lobste.buzzing.cc/feed.xml", 12],
  ["Buzzing Tech News", "https://tech.buzzing.cc/feed.xml", 12],
  ["Buzzing Reddit Ask", "https://ask.buzzing.cc/feed.xml", 12]
];

export const AIHOT_URL = "https://aihot.virxact.com/";
export const PRODUCT_HUNT_RSS_URL = "https://www.producthunt.com/feed";

/** 汇总后的过滤与截断参数（与原实现一致） */
export const RADAR_MIN_SCORE = 35;
export const RADAR_MAX_ITEMS = 80;
export const RADAR_TOP_ITEMS = 30;
export const RADAR_OPPORTUNITY_LIMIT = 12;
export const RADAR_BUCKET_ITEMS_PER_SOURCE = 5;
