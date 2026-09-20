import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

// 首页是服务端组件，真实仓储会打开 SQLite（jsdom 环境无法加载 node:sqlite）。
// 这里只验证渲染，因此把服务定位器换成内存实现，顺带让测试不依赖磁盘数据库。
// 工厂内部用动态导入，避免 vi.mock 提升导致的初始化顺序问题。
vi.mock("@/server/services", async () => {
  const { articleFixture } = await import("../../tests/fixtures/article");
  return {
    getArticleRepository: () => ({
      list: async () => [articleFixture()]
    })
  };
});

// 首页挂着 TopicRadarPanel（client 组件，用 useRouter）；默认折叠、不发起抓取。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

describe("HomePage", () => {
  it("shows the creator workspace heading", async () => {
    render(await HomePage());

    expect(
      screen.getByRole("heading", { name: "内容工作台" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "新建文章" })).toHaveAttribute(
      "href",
      "/articles/new"
    );
    // 热点选题雷达面板已挂载（默认折叠）
    expect(screen.getByRole("button", { name: /热点选题雷达/ })).toBeVisible();
  });

  it("lists the existing articles", async () => {
    render(await HomePage());

    expect(
      screen.getByRole("link", { name: "什么是机会成本" })
    ).toHaveAttribute("href", "/articles/article-1");
  });
});
