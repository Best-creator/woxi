import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewArticleForm } from "./new-article-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

function articleResponse() {
  return new Response(
    JSON.stringify({ article: { id: "article-1", updatedAt: "2026-09-13T00:00:00.000Z" } }),
    { status: 201 }
  );
}

describe("NewArticleForm", () => {
  it("does not submit a blank topic", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewArticleForm />);

    await user.click(screen.getByRole("button", { name: "创建文章" }));

    expect(screen.getByText("请输入要讲解的知识点")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("creates an article with a Markdown source", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(articleResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { id: "source-1" } }), { status: 201 }));
    render(<NewArticleForm />);

    await userEvent.click(screen.getByRole("button", { name: "添加资料" }));
    await userEvent.type(screen.getByLabelText("知识点"), "复利");
    await userEvent.type(screen.getByLabelText("资料标题"), "课堂笔记");
    await userEvent.type(screen.getByLabelText("资料内容"), "时间会放大积累。");
    await userEvent.click(screen.getByRole("button", { name: "创建文章" }));

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/articles/article-1/sources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "课堂笔记",
          type: "markdown",
          content: "时间会放大积累。"
        })
      })
    );
    expect(push).toHaveBeenCalledWith("/articles/article-1?step=outline");
    fetchSpy.mockRestore();
  });

  it("does not create the article when source mode is incomplete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewArticleForm />);

    await userEvent.click(screen.getByRole("button", { name: "添加资料" }));
    await userEvent.type(screen.getByLabelText("知识点"), "复利");
    await userEvent.type(screen.getByLabelText("资料标题"), "课堂笔记");
    await userEvent.click(screen.getByRole("button", { name: "创建文章" }));

    expect(screen.getByText("请输入资料标题和内容")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("quick 模式默认联网搜集资料后再跳转", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(articleResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            article: { id: "article-1", updatedAt: "2026-09-13T00:01:00.000Z" },
            source: { id: "source-1", type: "web" },
            queries: ["瑞利散射"],
            resultCount: 6
          }),
          { status: 200 }
        )
      );
    render(<NewArticleForm />);

    expect(screen.getByRole("checkbox")).toBeChecked();
    await userEvent.type(screen.getByLabelText("知识点"), "为什么天空是蓝色的");
    await user.click(screen.getByRole("button", { name: "创建文章" }));

    expect(await screen.findByText("正在联网搜集资料...")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/articles/article-1?step=outline");
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/articles/article-1/research",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: "2026-09-13T00:00:00.000Z" })
      })
    );
    fetchSpy.mockRestore();
  });

  it("取消勾选时不调用联网搜集", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(articleResponse());
    render(<NewArticleForm />);

    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("知识点"), "复利");
    await user.click(screen.getByRole("button", { name: "创建文章" }));

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/articles/article-1?step=outline");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("联网搜集失败时提示并允许跳过直接进入", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(articleResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "联网搜索暂时不可用，请稍后重试。" }), { status: 502 })
      );
    render(<NewArticleForm />);

    await userEvent.type(screen.getByLabelText("知识点"), "复利");
    await user.click(screen.getByRole("button", { name: "创建文章" }));

    expect(await screen.findByText(/联网搜集资料失败/)).toBeInTheDocument();
    const skipButton = await screen.findByRole("button", { name: "跳过资料直接进入" });
    await user.click(skipButton);
    expect(push).toHaveBeenCalledWith("/articles/article-1?step=outline");
    fetchSpy.mockRestore();
  });
});
