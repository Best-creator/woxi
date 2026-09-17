import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArticleReview } from "@/features/revisions/domain";
import type { ContentReviewResult } from "@/features/content/ports";
import { ContentReviewPanel } from "./content-review-panel";

function reviewWith(result: Partial<ContentReviewResult>, id = "review-1"): ArticleReview<ContentReviewResult> {
  return {
    id,
    revisionId: "revision-1",
    model: "writer-large",
    createdAt: "2026-09-10T00:00:00.000Z",
    result: {
      status: "passed",
      summary: "整体清晰。",
      clarity: 5,
      beginnerFriendliness: 4,
      coherence: 4,
      engagement: 3,
      outlineCoverage: 5,
      sourceFidelity: null,
      styleMatch: 4,
      issues: [],
      ...result
    }
  };
}

describe("ContentReviewPanel", () => {
  it("shows the verdict, the seven dimensions and lets issues jump to their blocks", async () => {
    const onLocateIssue = vi.fn();
    render(
      <ContentReviewPanel
        review={reviewWith({
          status: "needs_revision",
          issues: [{ blockIds: ["block-2"], severity: "warning", message: "这一段缺少过渡" }]
        })}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onApprove={vi.fn()}
        onLocateIssue={onLocateIssue}
      />
    );

    expect(screen.getByText("需要修订")).toBeVisible();
    expect(screen.getByText("清晰度")).toBeVisible();
    expect(screen.getByText("风格匹配")).toBeVisible();
    expect(screen.getByText("资料一致")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "这一段缺少过渡" }));

    expect(onLocateIssue).toHaveBeenCalledWith(["block-2"]);
  });

  it("blocks approval until a needs_revision warning is acknowledged", async () => {
    const onApprove = vi.fn();
    render(
      <ContentReviewPanel
        review={reviewWith({ status: "needs_revision" })}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onApprove={onApprove}
      />
    );

    const confirm = screen.getByRole("button", { name: "确认内容" });
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(confirm);

    expect(onApprove).toHaveBeenCalledWith(true);
  });

  it("keeps a blocked review from ever being confirmed", () => {
    render(
      <ContentReviewPanel
        review={reviewWith({
          status: "blocked",
          issues: [{ blockIds: [], severity: "blocking", message: "事实与资料冲突" }]
        })}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onApprove={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "确认内容" })).toBeDisabled();
  });

  it("marks an outdated review and blocks both actions", () => {
    render(
      <ContentReviewPanel
        review={reviewWith({})}
        isStale
        canReview
        onReview={vi.fn()}
        onApprove={vi.fn()}
      />
    );

    expect(screen.getByText("审核已过期")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认内容" })).toBeDisabled();
  });

  it("allows confirming directly when the body has not been reviewed", async () => {
    const onApprove = vi.fn();
    render(
      <ContentReviewPanel
        review={null}
        isStale={false}
        canReview
        onReview={vi.fn()}
        onApprove={onApprove}
      />
    );

    expect(screen.getByText("审核为可选步骤：可以直接确认内容，也可以先审核再确认")).toBeVisible();
    const confirm = screen.getByRole("button", { name: "直接确认（未审核）" });
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);

    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("warns when the body is built on an outdated outline", () => {
    render(
      <ContentReviewPanel
        review={null}
        isStale={false}
        staleOutline
        canReview={false}
        onReview={vi.fn()}
        onApprove={vi.fn()}
      />
    );

    expect(screen.getByText("当前正文基于旧大纲")).toBeVisible();
    expect(screen.getByRole("button", { name: "审核文案" })).toBeDisabled();
  });
});
