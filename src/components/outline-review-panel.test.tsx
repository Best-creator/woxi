import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArticleReview } from "@/features/revisions/domain";
import type { OutlineReviewResult } from "@/features/outlines/domain";
import { OutlineReviewPanel } from "./outline-review-panel";

function review(status: OutlineReviewResult["status"]): ArticleReview<OutlineReviewResult> {
  return {
    id: "review-1",
    revisionId: "revision-1",
    model: "demo",
    createdAt: "2026-09-10T00:00:00.000Z",
    result: {
      status,
      summary: "审核摘要",
      coverage: 5,
      granularity: 5,
      beginnerFriendliness: 5,
      logicalOrder: 5,
      sourceSupport: null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: status === "passed" ? [] : [{ sectionKey: "one", severity: status === "blocked" ? "blocking" : "warning", message: "需要处理的问题" }]
    }
  };
}

describe("OutlineReviewPanel", () => {
  it("blocks confirmation after a blocking review", () => {
    render(
      <OutlineReviewPanel
        review={review("blocked")}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("审核阻断")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
  });

  it("requires an explicit acknowledgement for a warning review", async () => {
    const onConfirm = vi.fn();
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const confirm = screen.getByRole("button", { name: "确认大纲" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "我已了解审核警告，仍要确认大纲" }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("marks a previously completed review stale and keeps confirmation unavailable", () => {
    render(
      <OutlineReviewPanel
        review={review("passed")}
        isStale
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("大纲或资料已更新，请重新审核后再确认大纲")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
  });

  it("guides a re-review when stale without any review to display", () => {
    render(
      <OutlineReviewPanel
        review={null}
        isStale
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("大纲或资料已更新，请重新审核后再确认大纲")).toBeVisible();
    expect(screen.queryByText("生成大纲后可进行审核")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "审核大纲" })).toBeEnabled();
  });

  it("offers applying a needs-revision review and hides it after a passed review", async () => {
    const onApplyReview = vi.fn();
    const { rerender } = render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        onApplyReview={onApplyReview}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "按审核意见改大纲" }));
    expect(onApplyReview).toHaveBeenCalledOnce();

    rerender(
      <OutlineReviewPanel
        review={review("passed")}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        onApplyReview={onApplyReview}
      />
    );
    expect(screen.queryByRole("button", { name: "按审核意见改大纲" })).not.toBeInTheDocument();
  });

  it("keeps review actions while showing a historical review", () => {
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        actionReview={null}
        isStale={false}
        canReview
        previewing
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        onApplyReview={vi.fn()}
      />
    );

    expect(screen.getByText("需要修订")).toBeVisible();
    expect(screen.getByText("审核摘要")).toBeVisible();
    expect(screen.getByText("需要处理的问题")).toBeVisible();
    expect(screen.getByRole("button", { name: "审核大纲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "按审核意见改大纲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says the previewed version has not been reviewed", () => {
    render(
      <OutlineReviewPanel
        review={null}
        actionReview={null}
        isStale={false}
        canReview
        previewing
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("该版本尚未审核")).toBeVisible();
    expect(screen.queryByText("生成大纲后可进行审核")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核大纲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeVisible();
  });

  it("shows no instruction box unless the caller wires up onRevise", () => {
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("补充要求")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按我的意见改大纲" })).not.toBeInTheDocument();
  });

  it("keeps the instruction box available after a passed review", () => {
    const props = {
      review: review("passed"),
      isStale: false,
      canReview: true,
      onReview: vi.fn(),
      onConfirm: vi.fn(),
      onInstructionsChange: vi.fn(),
      onRevise: vi.fn()
    };
    const { rerender } = render(<OutlineReviewPanel {...props} instructions="" />);

    // AI 说没问题，不代表作者不能提要求——这正是对话框存在的理由。
    expect(screen.queryByRole("button", { name: "按审核意见改大纲" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("补充要求")).toBeVisible();
    expect(screen.getByRole("button", { name: "按我的意见改大纲" })).toBeDisabled();

    rerender(<OutlineReviewPanel {...props} instructions="把第二章拆开讲透机制" />);
    expect(screen.getByRole("button", { name: "按我的意见改大纲" })).toBeEnabled();
  });

  it("reports typed instructions and applies them", async () => {
    const onInstructionsChange = vi.fn();
    const onRevise = vi.fn();
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        instructions="开场换成工位场景"
        onInstructionsChange={onInstructionsChange}
        onRevise={onRevise}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    await userEvent.type(screen.getByLabelText("补充要求"), "。");
    expect(onInstructionsChange).toHaveBeenCalledWith("开场换成工位场景。");

    await userEvent.click(screen.getByRole("button", { name: "按我的意见改大纲" }));
    expect(onRevise).toHaveBeenCalledOnce();
  });

  it("disables the instruction box while a revision is running", () => {
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        instructions="把第二章拆开"
        isRevising
        onInstructionsChange={vi.fn()}
        onRevise={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByLabelText("补充要求")).toBeDisabled();
    expect(screen.getByRole("button", { name: "修改中..." })).toBeDisabled();
  });

  it("hides the instruction box while previewing a historical version", () => {
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        actionReview={null}
        isStale={false}
        canReview
        previewing
        instructions="把第二章拆开"
        onInstructionsChange={vi.fn()}
        onRevise={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("补充要求")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按我的意见改大纲" })).not.toBeInTheDocument();
  });

  it("merges the two revise entries into one once instructions are typed", () => {
    const props = {
      review: review("needs_revision"),
      isStale: false,
      canReview: true,
      onReview: vi.fn(),
      onConfirm: vi.fn(),
      onApplyReview: vi.fn(),
      onInstructionsChange: vi.fn(),
      onRevise: vi.fn()
    };
    const { rerender } = render(<OutlineReviewPanel {...props} instructions="" />);

    // 没写字时两条路都在：一条纯审核意见，一条留给作者补充。
    expect(screen.getByRole("button", { name: "按审核意见改大纲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "按我的意见改大纲" })).toBeDisabled();

    rerender(<OutlineReviewPanel {...props} instructions="开场换成工位场景" />);

    // 写了字就只剩一个入口，避免点了纯审核那条把自己的要求丢掉。
    expect(screen.queryByRole("button", { name: "按审核意见改大纲" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按我的意见改大纲" })).toBeEnabled();
  });

  it("treats a whitespace-only request as empty", () => {
    render(
      <OutlineReviewPanel
        review={review("needs_revision")}
        isStale={false}
        canReview
        instructions="   "
        onInstructionsChange={vi.fn()}
        onRevise={vi.fn()}
        onApplyReview={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "按我的意见改大纲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "按审核意见改大纲" })).toBeEnabled();
  });
});
