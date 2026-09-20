import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSourceBuckets, cleanText, scoreItem, uniqueByUrl } from "./scoring";
import { fetchBilibiliPopular, fetchZhihuHot, parseSogouArticleList } from "./sources";
import { collectTopicRadar } from "./run";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const instantPause = () => Promise.resolve();

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("scoreItem（中文科普口径）", () => {
  it("科普词命中 + 设问标题得高分，给出科普向建议", () => {
    const item = scoreItem(
      {
        title: "为什么猫从高处摔下来总能四脚着地？背后的物理原理",
        url: "https://www.zhihu.com/question/123",
        source: "知乎热榜",
        summary: "猫的翻正反射与角动量守恒，一个经典的生命科学+物理科普话题",
        publishedAt: new Date().toISOString(),
        rawSignal: 20
      },
      NOW.getTime()
    );

    expect(item.score).toBeGreaterThanOrEqual(75);
    expect(item.recommendation).toBe("公众号深度科普");
    expect(item.selectionReason).toMatch(/入选原因/);
    expect(item.selectionReason).toMatch(/科普|设问/);
    expect(item.nextAction).toMatch(/建议/);
    expect(item.angles.length).toBeGreaterThan(0);
  });

  it("无关条目（娱乐八卦）被压到低分进观察名单", () => {
    const item = scoreItem(
      {
        title: "某明星官宣结婚，粉丝直呼爷青结",
        url: "https://example.com/ent",
        source: "知乎热榜",
        summary: "娱乐八卦新闻",
        publishedAt: new Date().toISOString(),
        rawSignal: 10
      },
      NOW.getTime()
    );
    expect(item.score).toBeLessThan(45);
    expect(item.recommendation).toBe("观察名单");
  });

  it("无科普词命中的高热度条目总分压顶 52，不霸榜（真机首跑踩过）", () => {
    const item = scoreItem(
      {
        title: "亚运会男篮铜牌赛，中国男篮 70-79 伊朗男篮，如何评价本场比赛？",
        url: "https://www.zhihu.com/question/999",
        source: "知乎热榜",
        summary: "亚运会男篮比赛评价",
        publishedAt: NOW.toISOString(),
        rawSignal: 24
      },
      NOW.getTime()
    );
    expect(item.score).toBeLessThanOrEqual(52);
    expect(item.scoreBreakdown.relevance).toBeLessThan(5);
  });

  it("旧条目 recency 记 0 分但不为负", () => {
    const item = scoreItem(
      {
        title: "黑洞照片公布背后的科学原理",
        url: "https://example.com/old",
        source: "知乎热榜",
        summary: "黑洞 科学 研究",
        publishedAt: "2020-01-01T00:00:00.000Z",
        rawSignal: 12
      },
      NOW.getTime()
    );
    expect(item.scoreBreakdown.recency).toBe(0);
    expect(item.score).toBeGreaterThan(0);
  });
});

describe("buildSourceBuckets", () => {
  it("按来源分桶供看板检查", () => {
    const items = [
      scoreItem({ title: "黑洞与相对论科普", url: "https://a.com/1", source: "知乎热榜", summary: "宇宙 物理", publishedAt: NOW.toISOString(), rawSignal: 15 }, NOW.getTime()),
      scoreItem({ title: "B站热门科普视频", url: "https://b.com/1", source: "B站热门", summary: "科学 实验", publishedAt: NOW.toISOString(), rawSignal: 14 }, NOW.getTime()),
      scoreItem({ title: "疫苗免疫原理", url: "https://a.com/2", source: "知乎热榜", summary: "医学 健康", publishedAt: NOW.toISOString(), rawSignal: 13 }, NOW.getTime())
    ];
    const buckets = buildSourceBuckets(items, 2);

    expect(buckets[0].source).toBe("知乎热榜");
    expect(buckets[0].count).toBe(2);
    expect(buckets[0].items).toHaveLength(2);
    expect(buckets[1].source).toBe("B站热门");
    expect(buckets[1].count).toBe(1);
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

describe("cleanText（搜狗解析的公共底座）", () => {
  it("剥 HTML 注释（<!--red_beg--> 高亮标记）与标签并解码实体", () => {
    expect(cleanText("【<!--red_beg-->科普<!--red_end-->】怎样让别人出手救你")).toBe("【科普】怎样让别人出手救你");
    expect(cleanText("  <b>Hello</b>   world &amp; more ")).toBe("Hello world & more");
  });
});

describe("fetchZhihuHot（知乎热榜）", () => {
  it("解析热度并转换站内链接", async () => {
    const stub: typeof fetch = vi.fn(async () => {
      return Response.json({
        data: [
          { target: { title: "老外的厕所究竟叫不叫“WC”？", url: "https://api.zhihu.com/questions/1001" }, detail_text: "152 万热度" },
          { target: { title: "《三体》小说中的自解译系统在现实中存在吗？", url: "https://api.zhihu.com/questions/1002" }, detail_text: "83 万热度" },
          { target: { title: "无链接条目应被丢弃", url: "" }, detail_text: "10 万热度" }
        ]
      });
    }) as unknown as typeof fetch;

    const items = await fetchZhihuHot(stub, NOW);
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("知乎热榜");
    expect(items[0].url).toBe("https://www.zhihu.com/question/1001");
    expect(items[0].rawSignal).toBeGreaterThan(20);
    expect(items[1].rawSignal).toBeLessThan(items[0].rawSignal);
  });

  it("请求失败返回空数组", async () => {
    silenceWarnings();
    const failing: typeof fetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await fetchZhihuHot(failing)).toEqual([]);
  });
});

describe("fetchBilibiliPopular（B站热门）", () => {
  it("解析 UP主/播放量/发布时间", async () => {
    const stub: typeof fetch = vi.fn(async () => {
      return Response.json({
        data: {
          list: [
            {
              title: "【硬核科普】芯片是怎么造出来的？",
              bvid: "BV1xx411c7mD",
              owner: { name: "科技解码" },
              stat: { view: 916637 },
              pubdate: Math.floor(NOW.getTime() / 1000) - 3600,
              desc: "从沙子到芯片的完整原理"
            }
          ]
        }
      });
    }) as unknown as typeof fetch;

    const items = await fetchBilibiliPopular(stub);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("B站热门");
    expect(items[0].author).toBe("科技解码");
    expect(items[0].url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(items[0].rawSignal).toBeGreaterThan(20);
    expect(items[0].publishedAt).toContain("T");
  });
});

describe("parseSogouArticleList（搜狗微信结果页，结构对齐 gzh-crawl 实测）", () => {
  const recentTs = Math.floor(NOW.getTime() / 1000) - 3600;
  const staleTs = Math.floor(NOW.getTime() / 1000) - 60 * 86_400;

  function sogouHtml(firstTs: number, secondTs: number): string {
    return `<html><body><ul class="news-list">
      <li id="sogou_vr_11002301_0">
        <div class="img-box"><img src="https://example.com/a.jpg"></div>
        <div class="txt-box">
          <h3><a href="/link?url=dn9a_abc123" target="_blank">【<em><!--red_beg-->科普<!--red_end--></em>】怎样让别人出手救你</a></h3>
          <p class="txt-info">这里提供一篇基于现代心理学研究结果的科普文章,告诉你为什么面对危险有人出手。</p>
          <div class="s-p"><a class="all-time-y2" href="javascript:;">槽边往事</a><span class="s2"></span><script>timeConvert('${firstTs}')</script></div>
        </div>
      </li>
      <li id="sogou_vr_11002301_1">
        <div class="txt-box">
          <h3><a href="/link?url=xyz789" target="_blank">一个月前的老文章应被过滤</a></h3>
          <p class="txt-info">过期内容</p>
          <div class="s-p"><a class="all-time-y2">某公众号</a><script>timeConvert('${secondTs}')</script></div>
        </div>
      </li>
    </ul></body></html>`;
  }

  it("解析标题/公众号/摘要并只留近 7 天", () => {
    const items = parseSogouArticleList(sogouHtml(recentTs, staleTs), "https://weixin.sogou.com", NOW);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("【科普】怎样让别人出手救你");
    expect(items[0].author).toBe("槽边往事");
    expect(items[0].source).toBe("公众号同行");
    expect(items[0].url).toBe("https://weixin.sogou.com/link?url=dn9a_abc123");
    expect(items[0].summary).toMatch(/心理学/);
    expect(items[0].publishedAt).toBe(new Date(recentTs * 1000).toISOString());
  });

  it("验证码/软风控页抛错（由调用方隔离为单关键词失败）", () => {
    expect(() => parseSogouArticleList("<html>请输入验证码</html>", "https://weixin.sogou.com", NOW)).toThrow(/风控/);
    expect(() => parseSogouArticleList("The URL has moved <a href=\"https://weixin.sogou.com/\">here</a>", "https://weixin.sogou.com", NOW)).toThrow(/风控/);
  });

  it("无 timeConvert 的条目被丢弃", () => {
    const html = `<ul class="news-list"><li><div class="txt-box"><h3><a href="/link?url=ok">一条没有时间戳的科普文章</a></h3></div></li></ul>`;
    expect(parseSogouArticleList(html, "https://weixin.sogou.com", NOW)).toEqual([]);
  });
});

describe("collectTopicRadar 汇总编排（三路中文源）", () => {
  /** 覆盖三路来源的 fetch 桩；搜狗按 query= 关键词分流，验证去重 */
  function buildStubFetch() {
    const sogouHtmlFor = (keyword: string) => `<html><body><ul class="news-list">
      <li><div class="txt-box">
        <h3><a href="/link?url=${encodeURIComponent(keyword)}-1">为什么睡够八小时还是困？<em><!--red_beg-->科普<!--red_end--></em>解读</a></h3>
        <p class="txt-info">睡眠科学与睡眠质量的关系</p>
        <div class="s-p"><a class="all-time-y2">神经科张医生</a><script>timeConvert('${Math.floor(NOW.getTime() / 1000) - 7200}')</script></div>
      </div></li>
    </ul></body></html>`;

    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.zhihu.com")) {
        return Response.json({
          data: [
            { target: { title: "猫为什么敢咬主人，它不怕被打被抛弃吗", url: "https://api.zhihu.com/questions/2001" }, detail_text: "143 万热度" }
          ]
        });
      }
      if (url.includes("api.bilibili.com")) {
        return Response.json({
          data: {
            list: [
              {
                title: "【硬核科普】黑洞照片是怎么拍出来的？",
                bvid: "BV1abc",
                owner: { name: "天文观测站" },
                stat: { view: 800000 },
                pubdate: Math.floor(NOW.getTime() / 1000) - 86400
              }
            ]
          }
        });
      }
      if (url.includes("weixin.sogou.com")) {
        const keyword = decodeURIComponent(url.match(/query=([^&]*)/)?.[1] ?? "");
        return new Response(sogouHtmlFor(keyword), { status: 200, headers: { "content-type": "text/html" } });
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

  it("三路来源合并、去重、打分、按分排序、过滤低分", async () => {
    const fetchStub = buildStubFetch() as unknown as typeof fetch;
    const data = await collectTopicRadar(fetchStub, NOW, { pause: instantPause });

    // 知乎 1 + B站 1 + 搜狗 5 关键词（同一条目去重后 1）
    expect(data.itemCount).toBe(3);
    const scores = data.topItems.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(data.sourceStats["知乎热榜"]).toBe(1);
    expect(data.sourceStats["B站热门"]).toBe(1);
    expect(data.sourceStats["公众号同行"]).toBe(1);
    expect(data.bySource.length).toBe(3);
    expect(data.generatedAt).toBe(NOW.toISOString());
    // 中文科普条目都在
    const titles = JSON.stringify(data.topItems);
    expect(titles).toMatch(/猫为什么敢咬主人/);
    expect(titles).toMatch(/黑洞照片/);
    expect(titles).toMatch(/睡够八小时/);
  });

  it("全部来源失败时返回 0 条且不抛错", async () => {
    const failing: typeof fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const data = await collectTopicRadar(failing, NOW, { pause: instantPause });
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

  function zhihuOnlyFetch(): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.zhihu.com")) {
        return Response.json({
          data: [{ target: { title: "为什么洗澡时唱歌特别好听？声学原理解析", url: "https://api.zhihu.com/questions/3001" }, detail_text: "50 万热度" }]
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
  }

  it("命中缓存后不再发请求；refresh=1 强制重抓", async () => {
    vi.resetModules();
    const mod = await import("./run");
    const fetchStub = zhihuOnlyFetch();

    const first = await mod.getTopicRadar({ pause: instantPause, fetchFn: fetchStub });
    expect(first.fresh).toBe(true);
    expect(first.data.itemCount).toBe(1);
    expect(first.cachedAt).not.toBeNull();
    const callsAfterFirst = (fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = await mod.getTopicRadar({ pause: instantPause, fetchFn: fetchStub });
    expect(second.fresh).toBe(false);
    expect(second.data).toBe(first.data);
    expect((fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    const third = await mod.getTopicRadar({ pause: instantPause, fetchFn: fetchStub, refresh: true });
    expect(third.fresh).toBe(true);
    expect((fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("抓到 0 条不写缓存，下一次请求会重试", async () => {
    vi.resetModules();
    const mod = await import("./run");
    const failing: typeof fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const first = await mod.getTopicRadar({ pause: instantPause, fetchFn: failing });
    expect(first.data.itemCount).toBe(0);
    expect(first.cachedAt).toBeNull();

    const second = await mod.getTopicRadar({ pause: instantPause, fetchFn: failing });
    expect(second.fresh).toBe(true);
  });
});
