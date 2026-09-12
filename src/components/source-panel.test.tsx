import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "@/features/sources/domain";
import { articleFixture } from "../../tests/fixtures/article";
import { SourcePanel } from "./source-panel";

const source: SourceDocument = {
  id: "source-1",
  articleId: "article-1",
  title: "课堂笔记",
  type: "markdown",
  content: "时间会放大积累。",
  status: "ready",
  enabled: true,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z"
};

describe("SourcePanel", () => {
  it("adds a Markdown source", async () => {
    const onChange = vi.fn();
    const createSource = vi.fn(async () => ({ source, article: articleFixture() }));
    render(
      <SourcePanel
        articleId="article-1"
        article={articleFixture()}
        sources={[]}
        onChange={onChange}
        createSource={createSource}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "添加资料" }));
    await userEvent.type(screen.getByLabelText("资料标题"), "课堂笔记");
    await userEvent.type(screen.getByLabelText("资料内容"), "时间会放大积累。");
    await userEvent.click(screen.getByRole("button", { name: "保存资料" }));

    expect(createSource).toHaveBeenCalledWith({
      title: "课堂笔记",
      type: "markdown",
      content: "时间会放大积累。"
    });
    expect(onChange).toHaveBeenCalledWith([source], articleFixture());
  });

  it("toggles and deletes a source", async () => {
    const onChange = vi.fn();
    const updateSource = vi.fn(async () => ({ source: { ...source, enabled: false }, article: articleFixture() }));
    const deleteSource = vi.fn(async () => ({ article: articleFixture() }));
    render(
      <SourcePanel
        articleId="article-1"
        article={articleFixture()}
        sources={[source]}
        onChange={onChange}
        updateSource={updateSource}
        deleteSource={deleteSource}
      />
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "启用课堂笔记" }));
    expect(updateSource).toHaveBeenCalledWith(source.id, false);

    await userEvent.click(screen.getByRole("button", { name: "删除课堂笔记" }));
    expect(deleteSource).toHaveBeenCalledWith(source.id);
  });
});
