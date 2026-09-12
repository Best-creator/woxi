import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { Article } from "@/features/articles/domain";
import { DEFAULT_STYLE_PROFILE } from "@/features/content/style-profile";
import { getWorkflowSteps, parseWorkflowStep } from "./workflow";

const article = (overrides: Partial<Article> = {}): Article => ({
  id: "article/1",
  title: "测试文章",
  topic: "测试主题",
  status: "draft",
  brief: null,
  outline: [],
  blocks: [],
  planning: {
    lengthPreset: "standard",
    recommendedTotalWords: null,
    confirmedOutlineRevisionId: null,
    contentOutlineRevisionId: null
  },
  styleProfile: { ...DEFAULT_STYLE_PROFILE },
  outlineConfirmedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("workflow step state", () => {
  it("parses only URL-safe workflow step values", () => {
    expect(parseWorkflowStep("outline")).toBe("outline");
    expect(parseWorkflowStep("images")).toBe("images");
    expect(parseWorkflowStep("article%2Fimages")).toBeNull();
    expect(parseWorkflowStep("unknown")).toBeNull();
    expect(parseWorkflowStep(null)).toBeNull();
  });

  it("keeps the outline enterable for a draft and locks later steps", () => {
    const steps = getWorkflowSteps(article(), 0, "sources");
    expect(steps.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "sources", status: "current" },
      { id: "outline", status: "available" },
      { id: "article", status: "locked" },
      { id: "images", status: "locked" }
    ]);
    expect(steps[2].lockedReason).toBeTruthy();
  });

  it("does not treat leftover blocks as a generated article until they belong to the confirmed outline", () => {
    const steps = getWorkflowSteps(article({
      status: "editing",
      brief: {
        oneSentence: "一句话",
        concepts: [],
        prerequisites: [],
        misconceptions: [],
        analogies: [],
        unsupportedNotes: []
      },
      outline: [{ id: "s1", title: "第一节", order: 0 }],
      blocks: [{ id: "legacy", type: "paragraph", content: "用大白话讲清楚：测试主题", order: 0, version: 1 }],
      outlineConfirmedAt: "2026-01-01T00:00:00.000Z",
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1000,
        confirmedOutlineRevisionId: "rev-1",
        contentOutlineRevisionId: null
      }
    }), 0, "article");

    expect(steps[2]).toMatchObject({ id: "article", status: "current" });
    expect(steps[3]).toMatchObject({ id: "images", status: "locked" });
  });

  it("marks outline-ready content complete and leaves the article next", () => {
    const steps = getWorkflowSteps(article({
      status: "outline_ready",
      brief: {
        oneSentence: "一句话",
        concepts: [],
        prerequisites: [],
        misconceptions: [],
        analogies: [],
        unsupportedNotes: []
      },
      outline: [{ id: "s1", title: "第一节", order: 0 }],
      outlineConfirmedAt: "2026-01-01T00:00:00.000Z",
      planning: {
        lengthPreset: "standard",
        recommendedTotalWords: 1000,
        confirmedOutlineRevisionId: "rev-1",
        contentOutlineRevisionId: "rev-1"
      }
    }), 0, "outline");
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("current");
    expect(steps[2].status).toBe("available");
  });

  it("keeps completion cumulative when persisted data is inconsistent", () => {
    const steps = getWorkflowSteps(article({ status: "editing", blocks: [{ id: "b1", type: "paragraph", content: "正文", order: 0, version: 1 }] }), 2, "article");
    expect(steps.map((step) => step.status)).toEqual(["current", "available", "locked", "locked"]);
    expect(steps[2].lockedReason).toBeTruthy();
  });

  it("allows a topic draft to enter the outline step", () => {
    const steps = getWorkflowSteps(article(), 0, "outline");
    expect(steps[1].status).toBe("current");
  });

  it("allows completed steps to be selected in the stepper", async () => {
    const { render, screen } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { vi } = await import("vitest");
    const { WorkflowStepper } = await import("@/components/workflow-stepper");
    const onSelect = vi.fn();
    render(createElement(WorkflowStepper, { steps: getWorkflowSteps(article({ status: "editing", brief: { oneSentence: "一句话", concepts: [], prerequisites: [], misconceptions: [], analogies: [], unsupportedNotes: [] }, outline: [{ id: "s1", title: "第一节", order: 0 }], blocks: [{ id: "b1", type: "paragraph", content: "正文", order: 0, version: 1 }] }), 0, "article"), onSelect }));
    await userEvent.click(screen.getByRole("button", { name: /资料来源/ }));
    expect(onSelect).toHaveBeenCalledWith("sources");
    await userEvent.click(screen.getByRole("button", { name: /文章大纲/ }));
    expect(onSelect).toHaveBeenCalledWith("outline");
    expect(screen.getByRole("button", { name: /配图/ })).toBeDisabled();
  });
});
