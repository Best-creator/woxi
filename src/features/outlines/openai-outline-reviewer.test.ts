import { describe, expect, it, vi } from "vitest";
import { OpenAiOutlineReviewer } from "./openai-outline-reviewer";

const reviewInput = {
  topic: "机会成本",
  sourceContext: undefined,
  outline: [
    { id: "section-a", title: "先看选择", goal: "建立直觉", recommendedWords: 500, order: 0 },
    { id: "section-b", title: "解释取舍", goal: "解释概念", recommendedWords: 500, order: 1 }
  ]
};

describe("OpenAiOutlineReviewer", () => {
  it("accepts a passed independent review without source context only when source support is null", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "passed",
      summary: "结构完整且适合零基础读者。",
      coverage: 5,
      granularity: 5,
      beginnerFriendliness: 5,
      logicalOrder: 5,
      sourceSupport: null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: []
    });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    const result = await reviewer.review(reviewInput);

    expect(result.status).toBe("passed");
    expect(result.sourceSupport).toBeNull();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 600_000,
      systemPrompt: expect.stringContaining("status")
    }));
  });

  it("rejects a review issue that cites a section outside the input outline", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "needs_revision",
      summary: "有一个章节需要调整。",
      coverage: 4,
      granularity: 4,
      beginnerFriendliness: 4,
      logicalOrder: 4,
      sourceSupport: null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: [{ sectionKey: "missing-section", severity: "warning", message: "章节过于跳跃。" }]
    });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).rejects.toThrow("大纲审核结果不符合要求");
  });

  it("accepts a needs-revision review that cites an input section", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "needs_revision",
      summary: "第二节需要补一个具体例子。",
      coverage: 4,
      granularity: 4,
      beginnerFriendliness: 4,
      logicalOrder: 5,
      sourceSupport: null,
      hiddenPrerequisites: ["读者需要先理解替代选项。"],
      complexDependencies: [],
      issues: [{ sectionKey: "section-b", severity: "warning", message: "补充一个熟悉的选择例子。" }]
    });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).resolves.toMatchObject({
      status: "needs_revision",
      issues: [{ sectionKey: "section-b" }]
    });
  });

  it("maps positional section keys from provider review responses", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "needs_revision",
      summary: "第二节需要补充证据。",
      coverage: 4,
      granularity: 4,
      beginnerFriendliness: 4,
      logicalOrder: 4,
      sourceSupport: null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: [{ sectionKey: "section-2", severity: "warning", message: "补充证据。" }]
    });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).resolves.toMatchObject({
      issues: [{ sectionKey: "section-b" }]
    });
  });

  it("rejects a blocked review unless it contains a blocking issue", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "blocked",
      summary: "缺少必要内容。",
      coverage: 1,
      granularity: 2,
      beginnerFriendliness: 2,
      logicalOrder: 2,
      sourceSupport: null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: [{ sectionKey: "section-a", severity: "warning", message: "需要补充定义。" }]
    });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).rejects.toThrow("大纲审核结果不符合要求");
  });

  it("accepts a blocked review with a blocking issue and rejects source support without sources", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        status: "blocked",
        summary: "核心定义缺失，无法判断章节是否正确。",
        coverage: 1,
        granularity: 2,
        beginnerFriendliness: 2,
        logicalOrder: 2,
        sourceSupport: null,
        hiddenPrerequisites: ["读者需要先理解最佳替代选择。"],
        complexDependencies: ["后续章节依赖尚未定义的核心概念。"],
        issues: [{ sectionKey: "section-a", severity: "blocking", message: "先定义核心概念。" }]
      })
      .mockResolvedValueOnce({
        status: "passed",
        summary: "结构完整。",
        coverage: 5,
        granularity: 5,
        beginnerFriendliness: 5,
        logicalOrder: 5,
        sourceSupport: 5,
        hiddenPrerequisites: [],
        complexDependencies: [],
        issues: []
      });
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).resolves.toMatchObject({ status: "blocked" });
    await expect(reviewer.review(reviewInput)).rejects.toThrow("大纲审核结果不符合要求");
  });
});
