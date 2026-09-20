import type { RadarRawItem } from "./types";
import { BILIBILI_POPULAR_FALLBACK_URL, BILIBILI_POPULAR_URL, SOGOU_BASE_URL, SOGOU_KEYWORDS, SOGOU_MAX_AGE_MS, ZHIHU_HOT_URL } from "./keywords";
import { cleanText } from "./scoring";

/**
 * 三路中文科普信号源（2026-09-20 换源）：
 *  - 知乎热榜（匿名 JSON，标题 + 热度）
 *  - B站热门（匿名 JSON，标题 + UP主 + 播放量 + 发布时间）
 *  - 搜狗微信文章搜索（同行公众号科普文章；解析结构对齐 gzh-crawl src/sogou.mjs 的实测结论：
 *    标题在 .txt-box h3 a、摘要在 p.txt-info、公众号名在 .all-time-y2、秒级时间戳藏在 timeConvert('...')）
 * 每个来源独立 try/catch：单源失败 console.warn 后返回 []，绝不拖垮整轮汇总；fetchFn 可注入。
 * ⚠️ 搜狗对连续访问敏感（会出验证码）：只在手动刷新时请求 + 30 分钟缓存 + 关键词间停顿。
 */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;

const defaultPause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string, fetchFn: typeof fetch, referer?: string): Promise<string> {
  const response = await fetchFn(url, {
    headers: {
      "user-agent": BROWSER_UA,
      accept: "text/html,application/json,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      ...(referer ? { referer } : {})
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 知乎热榜（api.zhihu.com/topstory/hot-list，匿名可用） */
export async function fetchZhihuHot(fetchFn: typeof fetch, now = new Date()): Promise<RadarRawItem[]> {
  try {
    const json = JSON.parse(await fetchText(ZHIHU_HOT_URL, fetchFn)) as {
      data?: Array<{ target?: { title?: string; url?: string }; detail_text?: string }>;
    };
    if (!Array.isArray(json.data)) {
      throw new Error("响应形状异常（data 非数组）");
    }
    return (json.data || [])
      .map((entry): RadarRawItem | null => {
        const title = cleanText(entry.target?.title ?? "");
        if (!title) return null;
        // api.zhihu.com/questions/{id} → www.zhihu.com/question/{id}，articles → zhuanlan
        const url = (entry.target?.url ?? "")
          .replace("api.zhihu.com/questions/", "www.zhihu.com/question/")
          .replace("api.zhihu.com/articles/", "zhuanlan.zhihu.com/p/")
          .replace("api.zhihu.com/", "www.zhihu.com/");
        // detail_text 形如「1294 万热度」；防御式解析
        const hotWan = Number((entry.detail_text ?? "").match(/([\d.]+)/)?.[1] ?? 0);
        return {
          title,
          url,
          source: "知乎热榜",
          summary: title,
          publishedAt: now.toISOString(),
          rawSignal: Math.min(32, hotWan > 0 ? 12 + Math.log10(hotWan + 1) * 6 : 8)
        };
      })
      .filter((item): item is RadarRawItem => item !== null && item.url.startsWith("http"));
  } catch (error) {
    console.warn(`topic-radar 知乎热榜失败: ${describeError(error)}`);
    return [];
  }
}

/**
 * B站源：优先知识区排行榜（科普 UP 主热帖），被风控拦截（code -352 等）或空时回退全站 popular。
 * 两端点结构一致（data.list），解析共用。
 */
export async function fetchBilibiliPopular(fetchFn: typeof fetch): Promise<RadarRawItem[]> {
  const parseBilibiliResponse = (json: BilibiliRankingResponse): RadarRawItem[] =>
    (json.data?.list || [])
      .slice(0, 40)
      .map((video): RadarRawItem | null => {
        const title = cleanText(video.title ?? "");
        if (!title || !video.bvid) return null;
        const views = Number(video.stat?.view || 0);
        return {
          title,
          url: `https://www.bilibili.com/video/${video.bvid}`,
          source: "B站热门",
          author: video.owner?.name || "",
          summary: cleanText(video.desc || title).slice(0, 200),
          publishedAt: video.pubdate ? new Date(video.pubdate * 1000).toISOString() : new Date().toISOString(),
          rawSignal: Math.min(35, 8 + Math.log10(views + 1) * 7)
        };
      })
      .filter((item): item is RadarRawItem => item !== null);

  for (const [label, url] of [
    ["知识区排行", BILIBILI_POPULAR_URL],
    ["全站热门(回退)", BILIBILI_POPULAR_FALLBACK_URL]
  ] as const) {
    try {
      const json = JSON.parse(await fetchText(url, fetchFn, "https://www.bilibili.com/")) as BilibiliRankingResponse & { code?: number; message?: string };
      // B站风控软拒绝：HTTP 200 但 code 非 0（如 -352），必须显式识别，否则静默变空数组
      if (typeof json.code === "number" && json.code !== 0) {
        throw new Error(`bilibili code ${json.code}`);
      }
      const items = parseBilibiliResponse(json);
      if (items.length === 0) {
        throw new Error("empty list");
      }
      return items;
    } catch (error) {
      console.warn(`topic-radar B站${label}失败: ${describeError(error)}`);
    }
  }
  return [];
}

interface BilibiliRankingResponse {
  data?: {
    list?: Array<{
      title?: string;
      bvid?: string;
      owner?: { name?: string };
      stat?: { view?: number };
      pubdate?: number;
      desc?: string;
    }>;
  };
}

/**
 * 搜狗微信结果页解析（纯函数可测）。结构对齐 gzh-crawl 实测结论：
 * ul.news-list li → .txt-box h3 a（标题+跳转链）/ p.txt-info（摘要）/ .all-time-y2（公众号名）/
 * timeConvert('秒级时间戳')。标题里带 <!--red_beg--> 高亮注释，cleanText 会剥掉。
 */
export function parseSogouArticleList(html: string, baseUrl: string, now = new Date()): RadarRawItem[] {
  // 显式验证码页 + 软风控重定向页（"The URL has moved here"，63 字节）都视为被拦
  if (/请输入验证码|访问过于频繁|您的访问出错|antispider|verify\.html|The URL has moved/.test(html)) {
    throw new Error("搜狗触发风控，稍后再试");
  }
  const listHtml = html.match(/<ul class="news-list"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const blocks = listHtml.match(/<li[\s\S]*?<\/li>/g) ?? [];
  const items: RadarRawItem[] = [];
  for (const block of blocks) {
    const titleMatch = block.match(/<h3>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const title = cleanText(titleMatch[2]);
    const href = titleMatch[1];
    if (!title || !href) continue;
    const ts = Number(block.match(/timeConvert\('(\d+)'\)/)?.[1] ?? 0);
    if (!ts) continue; // 无时间戳的条目无法判定新鲜度，宁缺毋滥
    const publishedAt = new Date(ts * 1000);
    if (now.getTime() - publishedAt.getTime() > SOGOU_MAX_AGE_MS) continue; // 只留近 7 天
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const account = cleanText(block.match(/all-time-y2[^>]*>([^<]+)</)?.[1] ?? "");
    const summary = cleanText(block.match(/txt-info"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
    items.push({
      title,
      url,
      source: "公众号同行",
      author: account,
      summary: summary || title,
      publishedAt: publishedAt.toISOString(),
      rawSignal: 14
    });
  }
  return items;
}

async function fetchSogouPage(fetchFn: typeof fetch, keyword: string, now: Date): Promise<RadarRawItem[]> {
  const url = `${SOGOU_BASE_URL}/weixin?query=${encodeURIComponent(keyword)}&s_from=input&_sug_=n&type=2&ie=utf8&page=1`;
  const html = await fetchText(url, fetchFn, SOGOU_BASE_URL);
  return parseSogouArticleList(html, SOGOU_BASE_URL, now);
}

/**
 * 搜狗微信同行搜索：按科普关键词组逐个搜第 1 页，关键词之间随机停顿（降低验证码概率）。
 * 单个关键词失败（含验证码）只丢该词，不影响其他词。
 */
export async function fetchSogouWeixin(
  fetchFn: typeof fetch,
  options: { pause?: (ms: number) => Promise<void>; now?: Date } = {}
): Promise<RadarRawItem[]> {
  const pause = options.pause ?? defaultPause;
  const now = options.now ?? new Date();
  const all: RadarRawItem[] = [];
  for (const [index, keyword] of SOGOU_KEYWORDS.entries()) {
    if (index > 0) await pause(900 + Math.round(Math.random() * 700));
    try {
      all.push(...(await fetchSogouPage(fetchFn, keyword, now)));
    } catch (error) {
      console.warn(`topic-radar 搜狗微信失败（${keyword}）: ${describeError(error)}`);
    }
  }
  return all;
}
