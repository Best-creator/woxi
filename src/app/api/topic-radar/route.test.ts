import { describe, expect, it } from "vitest";
import { createTopicRadarRouteHandlers } from "./route";
import type { RadarData, TopicRadarSnapshot } from "@/features/topic-radar/types";

function snapshotFixture(): TopicRadarSnapshot {
  const data: RadarData = {
    generatedAt: "2026-09-20T00:00:00.000Z",
    sourceCount: 1,
    itemCount: 1,
    topItems: [
      {
        title: "为什么猫从高处摔下来总能四脚着地？背后的物理原理",
        url: "https://www.zhihu.com/question/123",
        source: "知乎热榜",
        summary: "猫的翻正反射与角动量守恒",
        publishedAt: "2026-09-20T00:00:00.000Z",
        rawSignal: 20,
        id: "abc123",
        score: 82,
        scoreBreakdown: { signal: 20, relevance: 22, contentFit: 16, business: 14, recency: 10 },
        tags: ["物理", "为什么"],
        angles: ["设问式开头：把标题的疑问做成冷开场"],
        recommendation: "公众号深度科普",
        selectionReason: "入选原因：知乎热榜 信号强度 20/25；科普关键词：物理。",
        nextAction: "建议：先核验信息源，拆成「现象 → 原理 → 生活应用」三段结构。"
      }
    ],
    byAction: {},
    sourceStats: { 知乎热榜: 1 },
    bySource: []
  };
  return { data, cachedAt: "2026-09-20T01:00:00.000Z", fresh: false };
}

describe("GET /api/topic-radar", () => {
  it("返回雷达快照并透传 refresh=1", async () => {
    const seen: Array<{ refresh?: boolean }> = [];
    const handlers = createTopicRadarRouteHandlers(async (options) => {
      seen.push(options);
      return snapshotFixture();
    });

    const response = await handlers.GET(new Request("http://localhost/api/topic-radar?refresh=1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as TopicRadarSnapshot;
    expect(body.data.itemCount).toBe(1);
    expect(body.data.topItems[0].score).toBe(82);
    expect(seen[0]?.refresh).toBe(true);
  });

  it("默认走缓存（refresh 为 false）", async () => {
    const seen: Array<{ refresh?: boolean }> = [];
    const handlers = createTopicRadarRouteHandlers(async (options) => {
      seen.push(options);
      return snapshotFixture();
    });

    await handlers.GET(new Request("http://localhost/api/topic-radar"));
    expect(seen[0]?.refresh).toBe(false);
  });

  it("上游抛错时返回 502 与中文错误信息", async () => {
    const handlers = createTopicRadarRouteHandlers(async () => {
      throw new Error("boom");
    });

    const response = await handlers.GET(new Request("http://localhost/api/topic-radar"));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/抓取失败/);
  });
});
