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
        title: "An AI agent workflow automation tool for SaaS teams",
        url: "https://example.com/x",
        source: "AIHOT",
        summary: "AI agent workflow automation",
        publishedAt: "2026-09-19T00:00:00.000Z",
        rawSignal: 8,
        id: "abc123",
        score: 71,
        scoreBreakdown: { signal: 8, relevance: 25, contentFit: 17, business: 11, recency: 10 },
        tags: ["ai", "workflow"],
        angles: ["AI 工具/工作流拆解"],
        recommendation: "小红书工具卡 + 实测教程",
        selectionReason: "入选原因：AI/工具关键词：ai、workflow。",
        nextAction: "建议：做一张小红书卡片，标题突出具体人群和结果。"
      }
    ],
    opportunityItems: [],
    byAction: {},
    sourceStats: { AIHOT: 1 },
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
    expect(body.data.topItems[0].score).toBe(71);
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
