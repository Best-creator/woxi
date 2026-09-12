import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OutlineSection } from "@/features/articles/domain";
import { OutlineNav } from "./outline-nav";

const sections: OutlineSection[] = [
  { id: "one", title: "第一章", order: 0 },
  { id: "two", title: "第二章", order: 1 }
];

describe("OutlineNav", () => {
  async function enterEdit() {
    await userEvent.click(screen.getByRole("button", { name: "编辑章节结构" }));
  }

  it("lists section details as readable text until edit is requested", async () => {
    render(
      <OutlineNav
        sections={[{ id: "one", title: "第一章", goal: "建立直觉", recommendedWords: 500, order: 0 }]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText("第一章")).toBeVisible();
    expect(screen.getByText("建立直觉")).toBeVisible();
    expect(screen.getByText("500 字")).toBeVisible();
    expect(screen.queryByLabelText("第一章标题")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增章节" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑章节结构" }));

    expect(screen.getByLabelText("第一章标题")).toBeVisible();
    expect(screen.getByRole("button", { name: "新增章节" })).toBeVisible();
    expect(screen.getByRole("button", { name: "完成章节结构编辑" })).toBeVisible();
  });

  it("keeps section goals and word counts visible when read-only", () => {
    render(
      <OutlineNav
        sections={[{ id: "one", title: "第一章", goal: "建立直觉", recommendedWords: 500, order: 0 }]}
        readOnly
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText("第一章")).toBeVisible();
    expect(screen.getByText("建立直觉")).toBeVisible();
    expect(screen.getByText("500 字")).toBeVisible();
    expect(screen.queryByRole("link", { name: "第一章" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑章节结构" })).not.toBeInTheDocument();
  });

  it("moves and deletes only the selected section", async () => {
    const onChange = vi.fn();
    render(<OutlineNav sections={sections} onChange={onChange} />);
    await enterEdit();

    await userEvent.click(screen.getByRole("button", { name: "第二章上移" }));
    expect(onChange.mock.lastCall?.[0]).toEqual([
      { ...sections[1], order: 0 },
      { ...sections[0], order: 1 }
    ]);

    await userEvent.click(screen.getByRole("button", { name: "第一章删除" }));
    expect(onChange.mock.lastCall?.[0]).toEqual([{ ...sections[1], order: 0 }]);
  });

  it("edits the section goal and recommended word count", async () => {
    const onChange = vi.fn();
    function ControlledOutlineNav() {
      const [currentSections, setCurrentSections] = useState(sections);
      return <OutlineNav sections={currentSections} onChange={(next) => {
        onChange(next);
        setCurrentSections(next);
      }} />;
    }
    render(<ControlledOutlineNav />);
    await enterEdit();

    await userEvent.type(screen.getByLabelText("第一章目标"), "建立直觉");
    await userEvent.clear(screen.getByLabelText("第一章建议字数"));
    await userEvent.type(screen.getByLabelText("第一章建议字数"), "600");

    expect(onChange.mock.lastCall?.[0][0]).toEqual({
      ...sections[0],
      goal: "建立直觉",
      recommendedWords: 600
    });
  });
});
