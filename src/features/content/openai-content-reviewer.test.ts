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
    hookStrength: 4,
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

describe("sanitizeContentReview 的剧情漫画红线", () => {
  /** 剧情漫画的审核输入：每段 = 小标题块 + 文案块（与生成落库的形态一致）。 */
  function storyComicInput(overrides: Partial<ReviewContentInput> = {}): ReviewContentInput {
    return reviewInput({
      presentation: "story_comic",
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "一群小家伙围上来。", order: 1 },
        { id: "seg2-h", type: "heading", content: "机制", order: 2 },
        { id: "seg2-p", type: "paragraph", content: "带头的先跳上去。", order: 3 }
      ],
      ...overrides
    });
  }

  it("adds nothing when the copy keeps the red lines", () => {
    const result = reviewResult({ status: "passed" });
    expect(sanitizeContentReview(result, storyComicInput()).issues).toEqual([]);
  });

  it("flags an over-long segment against its own heading block", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "字".repeat(80), order: 1 }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);

    // 同一段既超段长又超句长：两条都贴出来，都定位到该段的小标题块。
    expect(sanitized.issues).toHaveLength(2);
    expect(sanitized.issues[0]).toMatchObject({ blockIds: ["seg1-h"], severity: "warning" });
    expect(sanitized.issues[0]!.message).toContain("「开场」段");
    expect(sanitized.issues[0]!.message).toContain("超过剧情漫画每段 60 字");
    expect(sanitized.issues[1]!.message).toContain("长句");
    // 只贴意见，不改结论：要不要改由作者决定（生成阶段已经拦过一遍模型产物）。
    expect(sanitized.status).toBe("passed");
  });

  it("flags long sentences, explanatory connectives and long enumerations", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "首先说清背景；其次再讲代价。", order: 1 },
        { id: "seg1-p2", type: "paragraph", content: "苹果、香蕉、橘子、梨、葡萄都摆着。", order: 2 },
        { id: "seg1-p3", type: "paragraph", content: "这句话故意写得很长很长，就是要超过二十二个字的限制才行。", order: 3 }
      ]
    });

    const messages = sanitizeContentReview(reviewResult({ status: "passed" }), input).issues.map(
      (issue) => issue.message
    );

    expect(messages.some((message) => message.includes("长句"))).toBe(true);
    expect(messages.some((message) => message.includes("分点推进"))).toBe(true);
    expect(messages.some((message) => message.includes("并列列举"))).toBe(true);
  });

  it("does not mistake a plain spoken 「最后」 for a textbook connective", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "最后还是最小的那只先找对了门道。", order: 1 }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });

  it("leaves the illustrated form alone", () => {
    const input = storyComicInput({
      presentation: "illustrated",
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "字".repeat(80), order: 1 }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });
});
