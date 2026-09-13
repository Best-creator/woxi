import { describe, expect, it } from "vitest";
import { parseSogouResults, SogouWebSearch } from "./sogou-web-search";

const SAMPLE_HTML = `
<div class="vrwrap">
  <h3 class="vr-title"><a href="/link?url=abc" target="_blank">瑞利散射_百度百科</a></h3>
  <p class="fz-mid space-txt">瑞利散射是指半径远小于光的波长的微粒对入射光的散射。</p>
</div>
<div class="vrwrap">
  <h3 class="vr-title"><a href="https://zhuanlan.example.com/post/1" target="_blank">为什么天空是<em>蓝色</em>的？</a></h3>
  <p class="fz-mid space-txt">蓝光波长短，更容易被大气分子散射，所以天空呈现蓝色。</p>
</div>
<div class="vrwrap">
  <h3 class="vr-title"><a href="/link?url=def" target="_blank">无摘要的结果</a></h3>
</div>
`;

describe("parseSogouResults", () => {
  it("提取标题、链接与摘要，并把相对链接补全", () => {
    const results = parseSogouResults(SAMPLE_HTML, 10);
    expect(results).toHaveLength(3);
    expect(results[0].title).toBe("瑞利散射_百度百科");
    expect(results[0].url).toBe("https://www.sogou.com/link?url=abc");
    expect(results[0].snippet).toContain("瑞利散射是指");
    expect(results[1].title).toBe("为什么天空是蓝色的？");
    expect(results[1].url).toBe("https://zhuanlan.example.com/post/1");
  });

  it("摘要数量少于标题时，缺失的摘要为空字符串", () => {
    const results = parseSogouResults(SAMPLE_HTML, 10);
    expect(results[2].title).toBe("无摘要的结果");
    expect(results[2].snippet).toBe("");
  });

  it("遵守 limit 上限", () => {
    const results = parseSogouResults(SAMPLE_HTML, 1);
    expect(results).toHaveLength(1);
  });

  it("没有结果时返回空数组", () => {
    expect(parseSogouResults("<html><body>验证码页面</body></html>", 10)).toEqual([]);
  });
});

describe("SogouWebSearch", () => {
  it("请求失败时抛出 ResearchError", async () => {
    const search = new SogouWebSearch((async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(search.search("瑞利散射", 8)).rejects.toMatchObject({ code: "search_unavailable" });
  });

  it("非 2xx 响应时抛出 ResearchError", async () => {
    const search = new SogouWebSearch((async () => new Response("blocked", { status: 403 })) as unknown as typeof fetch);
    await expect(search.search("瑞利散射", 8)).rejects.toMatchObject({ code: "search_unavailable" });
  });
});
