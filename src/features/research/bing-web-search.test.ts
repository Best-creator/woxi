import { describe, expect, it } from "vitest";
import { parseBingRss, BingWebSearch } from "./bing-web-search";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<item><title>瑞利散射_百度百科</title><link>https://baike.example.com/rayleigh</link><description><![CDATA[瑞利散射是半径远小于波长微粒的散射。]]></description></item>
<item><title>为什么天空是蓝色的</title><link>https://example.com/blue-sky</link><description>蓝光更容易被散射&amp;所以天空是蓝的</description></item>
<item><title></title><link>https://example.com/empty</link><description>无标题条目应被跳过</description></item>
</channel></rss>`;

describe("parseBingRss", () => {
  it("提取标题、链接与摘要，并处理 CDATA 与实体", () => {
    const results = parseBingRss(SAMPLE_XML, 10);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("瑞利散射_百度百科");
    expect(results[0].url).toBe("https://baike.example.com/rayleigh");
    expect(results[0].snippet).toContain("瑞利散射是");
    expect(results[1].snippet).toContain("&所以天空是蓝的");
  });

  it("遵守 limit 上限并跳过无标题条目", () => {
    const results = parseBingRss(SAMPLE_XML, 1);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("瑞利散射_百度百科");
  });
});

describe("BingWebSearch", () => {
  it("返回空结果时抛出 ResearchError", async () => {
    const search = new BingWebSearch((async () =>
      new Response("<rss><channel></channel></rss>", { status: 200 })) as unknown as typeof fetch);
    await expect(search.search("瑞利散射", 8)).rejects.toMatchObject({ code: "search_unavailable" });
  });

  it("解析成功时返回条目", async () => {
    const search = new BingWebSearch((async () =>
      new Response(SAMPLE_XML, { status: 200 })) as unknown as typeof fetch);
    const results = await search.search("瑞利散射", 8);
    expect(results).toHaveLength(2);
  });
});
