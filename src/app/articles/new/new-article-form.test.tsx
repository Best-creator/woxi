import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewArticleForm } from "./new-article-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

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
      .mockResolvedValueOnce(new Response(JSON.stringify({ article: { id: "article-1" } }), { status: 201 }))
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
});
