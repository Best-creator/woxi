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
      sourceStats: { 知乎热榜: 1, "B站热门": 1 },
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
    expect(await screen.findByText("为什么猫从高处摔下来总能四脚着地？背后的物理原理")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledWith("/api/topic-radar");
    expect(screen.getByText("用这个选题开文")).toBeVisible();
    expect(screen.getByText("知乎热榜")).toBeVisible();
    fetchSpy.mockRestore();
  });

  it("重新抓取按钮携带 refresh=1", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(radarResponse());
    render(<TopicRadarPanel />);

    await user.click(screen.getByRole("button", { name: /热点选题雷达/ }));
    await screen.findByText("为什么猫从高处摔下来总能四脚着地？背后的物理原理");
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
    await screen.findByText("为什么猫从高处摔下来总能四脚着地？背后的物理原理");
    await user.click(screen.getByRole("button", { name: "用这个选题开文" }));

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/articles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ topic: "为什么猫从高处摔下来总能四脚着地？背后的物理原理" })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/articles/article-1/sources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "选题雷达：为什么猫从高处摔下来总能四脚着地？背后的物理原理",
          type: "markdown",
          content: [
            "**来源**：知乎热榜",
            "**链接**：https://www.zhihu.com/question/123",
            "**摘要**：猫的翻正反射与角动量守恒",
            "**入选原因**：入选原因：知乎热榜 信号强度 20/25；科普关键词：物理。",
            "**雷达建议**：建议：先核验信息源，拆成「现象 → 原理 → 生活应用」三段结构。"
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
