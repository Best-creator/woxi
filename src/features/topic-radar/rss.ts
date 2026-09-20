import type { RadarFeedEntry } from "./types";
import { cleanText, decodeEntities } from "./scoring";

/**
 * 轻量 RSS/Atom 解析，替代原「选题雷达」的 rss-parser（零新增依赖）。
 * 只提取 title / link / 摘要 / 时间四个字段，解析失败返回空数组（各来源独立降级）。
 * 写法参照 features/research/bing-web-search.ts 的正则抽取模式。
 */

function decodeXmlEntities(text: string): string {
  return decodeEntities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlEntities(match[1]) : "";
}

/** Atom 的 <link href="..." />（也可能是 <link>text</link>） */
function extractLink(block: string): string {
  const tagged = extractTag(block, "link");
  if (tagged) return tagged;
  const href = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/i);
  return href ? decodeXmlEntities(href[1]) : "";
}

/**
 * 解析 RSS 2.0（<item>）或 Atom（<entry>）。
 * 注意 link 出现在 <item> 里时 <link> 标签内的 URL 会被 XML 实体转义（&amp;），decodeXmlEntities 已处理。
 */
export function parseRadarFeed(xml: string): RadarFeedEntry[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g) ?? [];
  const entries: RadarFeedEntry[] = [];
  for (const block of blocks) {
    const title = cleanText(extractTag(block, "title"));
    const link = extractLink(block);
    if (!title || !link) continue;
    const snippet = [extractTag(block, "description"), extractTag(block, "summary"), extractTag(block, "content")].find((part) => part.length > 0) ?? "";
    const date = [extractTag(block, "pubDate"), extractTag(block, "published"), extractTag(block, "updated"), extractTag(block, "date")].find((part) => part.length > 0) ?? "";
    entries.push({ title, link, contentSnippet: cleanText(snippet).slice(0, 300), isoDate: date });
  }
  return entries;
}
