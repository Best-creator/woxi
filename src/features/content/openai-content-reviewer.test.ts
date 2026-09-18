// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveStyleProfile } from "./style-profile";
import { sanitizeContentReview } from "./openai-content-reviewer";
import type { ContentReviewResult, ReviewContentInput } from "./ports";

function reviewInput(overrides: Partial<ReviewContentInput> = {}): ReviewContentInput {
  return {
    topic: "机会成本",
    styleProfile: resolveStyleProfile("popular_science_teacher"),
    blocks: [
      { id: "block-1", type: "paragraph", content: "第一段", order: 0 },
      { id: "block-2", type: "paragraph", content: "第二段", order: 1 }
    ],
    outline: [],
    ...overrides
  };
}

function reviewResult(overrides: Partial<ContentReviewResult> = {}): ContentReviewResult {
  return {
    status: "needs_revision",
    summary: "整体可读",
    clarity: 4,
    beginnerFriendliness: 4,
    coherence: 4,
    engagement: 4,
    outlineCoverage: 4,
    sourceFidelity: null,
    styleMatch: 4,
    issues: [],
    ...overrides
  };
}

describe("sanitizeContentReview", () => {
  it("drops hallucinated block ids but keeps the issue itself", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        issues: [
          { blockIds: ["block-2", "block-hallucinated"], severity: "warning", message: "第二段单薄" },
          { blockIds: ["ghost-1"], severity: "warning", message: "结尾仓促" }
        ]
      }),
      reviewInput()
    );

    expect(sanitized.issues[0]!.blockIds).toEqual(["block-2"]);
    // 全部 id 都虚构的意见退化为「不可定位」：意见保留，UI 的定位按钮自然禁用。
    expect(sanitized.issues[1]!.blockIds).toEqual([]);
  });

  it("keeps valid ids and a passing review untouched", () => {
    const result = reviewResult({
      status: "passed",
      issues: [{ blockIds: ["block-1"], severity: "warning", message: "小瑕疵" }]
    });

    expect(sanitizeContentReview(result, reviewInput())).toEqual(result);
  });

  it("coerces sourceFidelity to null without sources, and to a neutral score when the model omits it", () => {
    const withoutSource = sanitizeContentReview(
      reviewResult({ sourceFidelity: 5 }),
      reviewInput()
    );
    expect(withoutSource.sourceFidelity).toBeNull();

    const withSource = sanitizeContentReview(
      reviewResult({ sourceFidelity: null }),
      reviewInput({ sourceContext: "【资料】袋熊的肠道构造……" })
    );
    expect(withSource.sourceFidelity).toBe(3);
  });

  it("downgrades a blocked review that lacks a blocking issue", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        status: "blocked",
        issues: [{ blockIds: [], severity: "warning", message: "表达不稳" }]
      }),
      reviewInput()
    );

    expect(sanitized.status).toBe("needs_revision");
  });

  it("keeps blocked when a blocking issue supports it", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        status: "blocked",
        issues: [{ blockIds: ["block-1"], severity: "blocking", message: "事实错误" }]
      }),
      reviewInput()
    );

    expect(sanitized.status).toBe("blocked");
  });
});
