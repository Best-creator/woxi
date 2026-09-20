import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSourceBuckets, cleanText, detectOpportunitySignals, scoreItem, uniqueByUrl } from "./scoring";
import { parseRadarFeed } from "./rss";
import { extractHtmlLinks, mapBuzzingFeedItems, mapHuggingFaceModels } from "./sources";
import { collectTopicRadar } from "./run";

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("scoreItem（移植自选题雷达 radar.test.mjs）", () => {
  it("给出入选原因与下一步建议", () => {
    const item = scoreItem({
      title: "Acme AI workflow CRM API",
      url: "https://example.com/acme",
      source: "Example Source",
      summary: "AI agent workflow automation for SaaS customer support with API integration",
      publishedAt: new Date().toISOString(),
      rawSignal: 18
    });

    expect(typeof item.selectionReason).toBe("string");
    expect(item.selectionReason).toMatch(/入选原因/);
    expect(item.selectionReason).toMatch(/AI|SaaS|工作流|API/);
    expect(typeof item.nextAction).toBe("string");
    expect(item.nextAction).toMatch(/建议/);
    expect(item.nextAction.length).toBeGreaterThanOrEqual(12);
  });

  it("负反馈吐槽被提升为开发机会", () => {
    const signals = detectOpportunitySignals("Tell HN: This SaaS billing workflow is painfully hard and impossible to cancel");
    expect(signals.hasComplaint).toBe(true);
    expect(signals.complaintHits).toContain("painfully hard");

    const item = scoreItem({
      title: "Tell HN: This SaaS billing workflow is painfully hard and impossible to cancel",
      url: "https://news.ycombinator.com/item?id=3",
      source: "Buzzing HN Front",
      summary: "users complain this SaaS is broken, slow and impossible to cancel",
      publishedAt: new Date().toISOString(),
      rawSignal: 14
    });

    expect(item.opportunity?.type).toBe("用户吐槽/开发机会");
    expect(item.recommendation).toMatch(/用户吐槽|开发机会/);
    expect(item.nextAction).toMatch(/负反馈|MVP|替代方案|开发机会/);
  });

  it("旧条目 recency 记 0 分但不为负", () => {
    const item = scoreItem({
      title: "Old AI agent workflow",
      url: "https://example.com/old",
      source: "Example",
      summary: "AI agent workflow automation",
      publishedAt: "2020-01-01T00:00:00.000Z",
      rawSignal: 12
    });
    expect(item.scoreBreakdown.recency).toBe(0);
    expect(item.score).toBeGreaterThan(0);
  });
});

describe("mapHuggingFaceModels（移植）", () => {
  it("把 Hub 模型映射为雷达条目", () => {
    const items = mapHuggingFaceModels([
      {
        id: "Qwen/Qwen3-Embedding-4B",
        modelId: "Qwen/Qwen3-Embedding-4B",
        tags: ["sentence-transformers", "feature-extraction", "text-embeddings-inference"],
        likes: 123,
        downloads: 45678,
        lastModified: "2026-05-10T00:00:00.000Z",
        pipeline_tag: "feature-extraction"
      }
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("Hugging Face Models");
    expect(items[0].url).toBe("https://huggingface.co/Qwen/Qwen3-Embedding-4B");
    expect(items[0].title).toMatch(/Qwen\/Qwen3-Embedding-4B/);
    expect(items[0].summary).toMatch(/sentence-transformers/);
    expect(items[0].rawSignal).toBeGreaterThan(10);
  });
});

describe("buildSourceBuckets（移植）", () => {
  it("按来源分桶供看板检查", () => {
    const items = [
      scoreItem({ title: "HN AI agent workflow", url: "https://news.ycombinator.com/item?id=1", source: "Hacker News", summary: "AI agent workflow discussion", publishedAt: new Date().toISOString(), rawSignal: 15 }),
      scoreItem({ title: "X AI SaaS launch", url: "https://x.com/example/status/1", source: "X/Twitter", summary: "AI SaaS launch thread", publishedAt: new Date().toISOString(), rawSignal: 14 }),
      scoreItem({ title: "HN SaaS API", url: "https://news.ycombinator.com/item?id=2", source: "Hacker News", summary: "SaaS API case", publishedAt: new Date().toISOString(), rawSignal: 13 })
    ];
    const buckets = buildSourceBuckets(items, 2);

    expect(buckets[0].source).toBe("Hacker News");
    expect(buckets[0].count).toBe(2);
    expect(buckets[0].items).toHaveLength(2);
    expect(buckets[1].source).toBe("X/Twitter");
    expect(buckets[1].count).toBe(1);
  });
});

describe("mapBuzzingFeedItems（移植）", () => {
  it("保留子来源并只留下 AI/独立开发相关条目", () => {
    const items = mapBuzzingFeedItems("Buzzing Product Hunt", [
      { title: "Frontdesk AI - AI COO for small business SaaS", link: "https://producthunt.com/posts/frontdesk-ai", contentSnippet: "AI tool for business workflow", isoDate: "2026-05-14T00:00:00.000Z" },
      { title: "Random football match", link: "https://example.com/sports", contentSnippet: "sports recap", isoDate: "2026-05-14T00:00:00.000Z" },
      { title: "I built a side project with 10k users", link: "https://reddit.com/r/SideProject/1", contentSnippet: "indie founder launch story", isoDate: "2026-05-14T00:00:00.000Z" }
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("Buzzing Product Hunt");
    const titles = items.map((item) => item.title).join("\n");
    expect(titles).toMatch(/Frontdesk AI/);
    expect(titles).toMatch(/side project/);
  });

  it("吐槽条目信号更高", () => {
    const items = mapBuzzingFeedItems("Buzzing HN Front", [
      { title: "This billing tool is painfully hard to use", link: "https://example.com/complaint", contentSnippet: "users complain the SaaS app is broken and slow", isoDate: "2026-09-19T00:00:00.000Z" },
      { title: "A new AI agent for browser automation", link: "https://example.com/normal", contentSnippet: "AI agent workflow tool for teams", isoDate: "2026-09-19T00:00:00.000Z" }
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.url.includes("complaint"))?.rawSignal).toBe(16);
    expect(items.find((item) => item.url.includes("normal"))?.rawSignal).toBe(13);
  });
});

describe("parseRadarFeed（rss-parser 的零依赖替代）", () => {
  it("解析 RSS 2.0：CDATA、实体、pubDate", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title><![CDATA[Acme &amp; AI 把工具链跑通]]></title>
        <link>https://example.com/a?x=1&amp;y=2</link>
        <description><![CDATA[<p>AI agent workflow for SaaS teams</p>]]></description>
        <pubDate>Tue, 15 Sep 2026 08:00:00 GMT</pubDate>
      </item>
      <item>
        <title>没有 link 的条目应被丢弃</title>
        <description>orphan</description>
      </item>
    </channel></rss>`;
    const entries = parseRadarFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Acme & AI 把工具链跑通");
    expect(entries[0].link).toBe("https://example.com/a?x=1&y=2");
    expect(entries[0].contentSnippet).toBe("AI agent workflow for SaaS teams");
    expect(entries[0].isoDate).toContain("Sep");
  });

  it("解析 Atom entry：href 形式的 link 与 summary", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom entry title for MCP servers</title>
        <link href="https://example.com/atom-1" rel="alternate"/>
        <summary>browser agent discussion</summary>
        <updated>2026-09-18T00:00:00Z</updated>
      </entry>
    </feed>`;
    const entries = parseRadarFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].link).toBe("https://example.com/atom-1");
    expect(entries[0].contentSnippet).toBe("browser agent discussion");
    expect(entries[0].isoDate).toBe("2026-09-18T00:00:00Z");
  });

  it("坏 XML 返回空数组而不是抛错", () => {
    expect(parseRadarFeed("not xml at all")).toEqual([]);
  });
});

describe("extractHtmlLinks（cheerio 的零依赖替代）", () => {
  it("抽取正文链接并过滤短标题、javascript 与锚点", () => {
    const html = `<html><body>
      <a href="/post/ai-tools">Top 10 AI workflow tools for small teams</a>
      <a href="javascript:void(0)">bad javascript link should be skipped</a>
      <a href="/x#frag">anchor link should be skipped here</a>
      <a href="https://ext.example.com/story">This one is an absolute external URL</a>
      <a href="/short">tiny</a>
      <a>no href attribute at all here</a>
    </body></html>`;
    const items = extractHtmlLinks("AIHOT", html, "https://aihot.virxact.com/");
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("https://aihot.virxact.com/post/ai-tools");
    expect(items[0].source).toBe("AIHOT");
    expect(items[1].url).toBe("https://ext.example.com/story");
  });

  it("cleanText 去标签并压缩空白", () => {
    expect(cleanText("  <b>Hello</b>   world &amp; more ")).toBe("Hello world & more");
  });

  it("剔除锚点内嵌的 script/style 碎片（SSR 页面真机踩过）", () => {
    const html = `<a href="/p/1">Real AI agent tooling guide for teams<script>self.__next_f=self.__next_f||[];self.__next_f.push([0])</script></a>
      <a href="/p/2"><script>self.__next_f.push([1,"2E3"])</script></a>`;
    const items = extractHtmlLinks("AIHOT", html, "https://aihot.virxact.com/");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Real AI agent tooling guide for teams");
    expect(JSON.stringify(items)).not.toMatch(/__next_f/);
  });
});

describe("uniqueByUrl", () => {
  it("忽略查询串去重，title 兜底", () => {
    const items = [
      { title: "A", url: "https://example.com/x?utm=1" },
      { title: "B", url: "https://example.com/x" },
      { title: "C", url: "" },
      { title: "C" }
    ];
    const merged = uniqueByUrl(items);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("A");
    expect(merged[1].title).toBe("C");
  });
});

describe("collectTopicRadar 汇总编排", () => {
  /** 构造一个覆盖七路来源的 fetch 桩；同源多次请求返回同一响应（测去重） */
  function buildStubFetch() {
    const aihotHtml = `<a href="/post/ai-tools">Top 10 AI workflow tools for small teams</a>`;
    const buzzingXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Frontdesk AI - AI COO for small business SaaS</title><link>https://producthunt.com/posts/frontdesk-ai</link><description>AI tool for business workflow</description><pubDate>Tue, 15 Sep 2026 08:00:00 GMT</pubDate></item>
      <item><title>Random football match</title><link>https://example.com/sports</link><description>sports recap</description><pubDate>Tue, 15 Sep 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const phXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Launchpad for indie SaaS founders</title><link>https://producthunt.com/posts/launchpad</link><description>launch tools for indie makers</description><pubDate>Tue, 15 Sep 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`;

    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://aihot.virxact.com")) {
        return new Response(aihotHtml, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("buzzing.cc")) {
        return new Response(buzzingXml, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      if (url === "https://www.producthunt.com/feed") {
        return new Response(phXml, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      if (url.includes("hn.algolia.com")) {
        return Response.json({ hits: [{ title: "Show HN: I built an AI agent for browser automation", url: "https://example.com/hn-1", objectID: "1", created_at: "2026-09-19T10:00:00.000Z", points: 40, num_comments: 16 }] });
      }
      if (url.includes("api.github.com")) {
        return Response.json({ items: [{ full_name: "acme/ai-agent-starter", stargazers_count: 120, html_url: "https://github.com/acme/ai-agent-starter", description: "Open source AI agent workflow boilerplate for SaaS", created_at: "2026-09-10T00:00:00.000Z" }] });
      }
      if (url.includes("huggingface.co")) {
        return Response.json([{ modelId: "Qwen/Qwen3-Embedding-4B", tags: ["sentence-transformers"], likes: 123, downloads: 45678, lastModified: "2026-09-15T00:00:00.000Z", pipeline_tag: "feature-extraction" }]);
      }
      if (url.includes("dev.to")) {
        return Response.json([{ title: "How I automated my SaaS billing with AI agents", url: "https://dev.to/post/1", description: "billing automation workflow", published_at: "2026-09-18T00:00:00.000Z", public_reactions_count: 60, comments_count: 8 }]);
      }
      throw new Error(`unexpected url: ${url}`);
    });
  }

  beforeEach(() => {
    silenceWarnings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("七路来源合并、去重、打分、按分排序、过滤低分", async () => {
    const fetchStub = buildStubFetch() as unknown as typeof fetch;
    const now = new Date("2026-09-20T00:00:00.000Z");
    const data = await collectTopicRadar(fetchStub, now);

    expect(data.itemCount).toBe(7);
    expect(data.sourceCount).toBe(7);
    const scores = data.topItems.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(JSON.stringify(data.topItems)).not.toMatch(/football/i);
    expect(data.sourceStats["Hacker News"]).toBe(1);
    expect(data.sourceStats["AIHOT"]).toBe(1);
    expect(data.bySource).toHaveLength(7);
    expect(data.generatedAt).toBe(now.toISOString());
  });

  it("全部来源失败时返回 0 条且不抛错", async () => {
    const failing: typeof fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const data = await collectTopicRadar(failing);
    expect(data.itemCount).toBe(0);
    expect(data.topItems).toEqual([]);
  });
});

describe("getTopicRadar 缓存（30 分钟 + refresh 穿透）", () => {
  beforeEach(() => {
    silenceWarnings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("命中缓存后不再发请求；refresh=1 强制重抓", async () => {
    vi.resetModules();
    const mod = await import("./run");
    const aihotOnly: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://aihot.virxact.com")) {
        return new Response(`<a href="/p/1">An AI agent workflow automation tool for SaaS teams</a>`, { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;

    const first = await mod.getTopicRadar({ fetchFn: aihotOnly });
    expect(first.fresh).toBe(true);
    expect(first.data.itemCount).toBe(1);
    expect(first.cachedAt).not.toBeNull();
    const callsAfterFirst = (aihotOnly as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = await mod.getTopicRadar({ fetchFn: aihotOnly });
    expect(second.fresh).toBe(false);
    expect(second.data).toBe(first.data);
    expect((aihotOnly as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    const third = await mod.getTopicRadar({ fetchFn: aihotOnly, refresh: true });
    expect(third.fresh).toBe(true);
    expect((aihotOnly as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("抓到 0 条不写缓存，下一次请求会重试", async () => {
    vi.resetModules();
    const mod = await import("./run");
    const failing: typeof fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const first = await mod.getTopicRadar({ fetchFn: failing });
    expect(first.data.itemCount).toBe(0);
    expect(first.cachedAt).toBeNull();

    const second = await mod.getTopicRadar({ fetchFn: failing });
    expect(second.fresh).toBe(true);
    expect((failing as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
