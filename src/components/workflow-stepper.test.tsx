import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowStepper } from "./workflow-stepper";

describe("WorkflowStepper", () => {
  it("selects completed steps and disables locked steps", async () => {
    const onSelect = vi.fn();
    render(createElement(WorkflowStepper, {
      steps: [
        { id: "sources", label: "资料来源", status: "completed" },
        { id: "outline", label: "文章大纲", status: "current" },
        { id: "article", label: "正文文章", status: "locked", lockedReason: "请先完成文章大纲" },
        { id: "images", label: "配图", status: "locked", lockedReason: "请先完成正文文章" }
      ],
      onSelect
    }));
    await userEvent.click(screen.getByRole("button", { name: /资料来源/ }));
    expect(onSelect).toHaveBeenCalledWith("sources");
    expect(screen.getByRole("button", { name: /正文文章/ })).toBeDisabled();
    expect(screen.getByText("当前")).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(screen.getAllByText("已锁定").length).toBe(2);
    expect(screen.getByText("请先完成文章大纲")).toBeVisible();
    expect(screen.getByRole("button", { name: /正文文章/ })).toHaveAttribute("aria-describedby", "article-locked-reason");
  });
});
