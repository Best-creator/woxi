import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { articleFixture } from "../../tests/fixtures/article";
import { ArticleList } from "./article-list";

describe("ArticleList", () => {
  it("renders scannable article rows", () => {
    render(<ArticleList articles={[articleFixture()]} />);

    expect(
      screen.getByRole("link", { name: "什么是机会成本" })
    ).toBeVisible();
    expect(screen.getByText("草稿")).toBeVisible();
  });

  it("renders an actionable empty state", () => {
    render(<ArticleList articles={[]} />);

    expect(screen.getByText("还没有文章")).toBeVisible();
    expect(screen.getByRole("link", { name: "创建第一篇文章" })).toHaveAttribute(
      "href",
      "/articles/new"
    );
  });
});

