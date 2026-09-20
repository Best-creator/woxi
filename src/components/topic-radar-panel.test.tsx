import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TopicRadarPanel } from "./topic-radar-panel";
import type { TopicRadarSnapshot } from "@/features/topic-radar/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

function radarSnapshotFixture(): TopicRadarSnapshot {
  return {
    data: {
      generatedAt: "2026-09-20T08:00:00.000Z",
      sourceCount: 2,
      itemCount: 12,
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
          nextAction: "建议：做一张小红书卡片，标题突出具体人群和结果。",
          opportunity: { type: "用户吐槽/开发机会", complaintHits: ["broken"], contextHits: ["saas"] }
        }
      ],
      opportunityItems: [],
      byAction: {},
      sourceStats: { AIHOT: 1, "Hacker News": 1 },
      bySource: []
    },
    cachedAt: "2026-09-20T08:00:00.000Z",
    fresh: true
  };
}

function radarResponse(fixture = radarSnapshotFixture()) {
  return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
}

function articleResponse() {
  return new Response(JSON.stringify({ article: { id: "article-1", updatedAt: "2026-09-20T08:00:00.000Z" } }), {
    status: 201,
    headers: { "content-type": "application/json" }
  });
}

describe("TopicRadarPanel", () => {
  it("默认折叠，展开后才首次抓取", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(radarResponse());
    render(<TopicRadarPanel />);

    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    expect(await screen.findByText("An AI agent workflow automation tool for SaaS teams")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledWith("/api/topic-radar");
    expect(screen.getByText("用这个选题开文")).toBeVisible();
    expect(screen.getByText("吐槽 → 机会")).toBeVisible();
    fetchSpy.mockRestore();
  });

  it("重新抓取按钮携带 refresh=1", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(radarResponse());
    render(<TopicRadarPanel />);

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    await screen.findByText("An AI agent workflow automation tool for SaaS teams");
    await user.click(screen.getByRole("button", { name: "重新抓取" }));

    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/topic-radar?refresh=1");
    fetchSpy.mockRestore();
  });

  it("用这个选题开文：创建文章 + 保存资料摘要 + 跳转来源步骤", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(radarResponse())
      .mockResolvedValueOnce(articleResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { id: "source-1" } }), { status: 201 }));
    render(<TopicRadarPanel />);

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    await screen.findByText("An AI agent workflow automation tool for SaaS teams");
    await user.click(screen.getByRole("button", { name: "用这个选题开文" }));

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/articles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ topic: "An AI agent workflow automation tool for SaaS teams" })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/articles/article-1/sources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "选题雷达：An AI agent workflow automation tool for SaaS teams",
          type: "markdown",
          content: [
            "**来源**：AIHOT",
            "**链接**：https://example.com/x",
            "**摘要**：AI agent workflow automation",
            "**入选原因**：入选原因：AI/工具关键词：ai、workflow。",
            "**雷达建议**：建议：做一张小红书卡片，标题突出具体人群和结果。"
          ].join("\n\n"),
          expectedUpdatedAt: "2026-09-20T08:00:00.000Z"
        })
      })
    );
    expect(push).toHaveBeenCalledWith("/articles/article-1?step=sources");
    fetchSpy.mockRestore();
  });

  it("本轮 0 条时提示重新抓取", async () => {
    const user = userEvent.setup();
    const empty = radarSnapshotFixture();
    empty.data.itemCount = 0;
    empty.data.topItems = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(radarResponse(empty));
    render(<TopicRadarPanel />);

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    expect(await screen.findByText(/本轮没有抓到任何条目/)).toBeVisible();
    fetchSpy.mockRestore();
  });

  it("抓取失败时显示错误信息", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: "热点选题抓取失败，请稍后重试" }), { status: 502 }));
    render(<TopicRadarPanel />);

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    expect(await screen.findByText("热点选题抓取失败，请稍后重试")).toBeVisible();
    fetchSpy.mockRestore();
  });
});
