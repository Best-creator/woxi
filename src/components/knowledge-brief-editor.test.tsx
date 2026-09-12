import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBrief } from "@/features/articles/domain";
import { useState } from "react";
import { KnowledgeBriefEditor } from "./knowledge-brief-editor";

const brief: KnowledgeBrief = {
  oneSentence: "复利是时间放大积累的过程。",
  concepts: ["本金", "收益"],
  prerequisites: ["四则运算"],
  misconceptions: ["只看短期收益"],
  analogies: ["滚雪球"],
  unsupportedNotes: ["请核对来源"]
};

describe("KnowledgeBriefEditor", () => {
  function renderControlled(onChange: (brief: KnowledgeBrief) => void) {
    function Harness() {
      const [value, setValue] = useState(brief);
      return (
        <KnowledgeBriefEditor
          brief={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    return render(<Harness />);
  }

  async function enterEdit() {
    await userEvent.click(screen.getByRole("button", { name: "编辑知识梳理" }));
  }

  it("lists the brief as readable text until edit is requested", async () => {
    render(<KnowledgeBriefEditor brief={brief} onChange={vi.fn()} />);

    expect(screen.getByText("复利是时间放大积累的过程。")).toBeVisible();
    expect(screen.getByText("本金")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "一句话解释" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑知识梳理" }));

    expect(screen.getByLabelText("一句话解释")).toHaveValue("复利是时间放大积累的过程。");
    expect(screen.getByRole("button", { name: "完成知识梳理编辑" })).toBeVisible();
  });

  it("hides the edit control when read-only", () => {
    render(<KnowledgeBriefEditor brief={brief} readOnly onChange={vi.fn()} />);

    expect(screen.getByText("只读")).toBeVisible();
    expect(screen.getByText("复利是时间放大积累的过程。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "编辑知识梳理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "一句话解释" })).not.toBeInTheDocument();
  });

  it("edits one field while preserving the other fields", async () => {
    const onChange = vi.fn();
    renderControlled(onChange);
    await enterEdit();

    await userEvent.clear(screen.getByLabelText("一句话解释"));
    await userEvent.type(screen.getByLabelText("一句话解释"), "新的解释");

    const next = onChange.mock.lastCall?.[0] as KnowledgeBrief;
    expect(next.oneSentence).toBe("新的解释");
    expect(next.concepts).toEqual(brief.concepts);
  });

  it("edits array fields one line per item", async () => {
    const onChange = vi.fn();
    renderControlled(onChange);
    await enterEdit();

    fireEvent.change(screen.getByLabelText("核心概念"), {
      target: { value: "本金\n收益\n利率" }
    });

    const next = onChange.mock.lastCall?.[0] as KnowledgeBrief;
    expect(next.concepts).toEqual(["本金", "收益", "利率"]);
    expect(next.analogies).toEqual(brief.analogies);
  });
});
