import { describe, expect, it } from "vitest";
import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { OpenAiOutlineReviewer } from "./openai-outline-reviewer";

const reviewInput = {
  topic: "机会成本",
  sourceContext: undefined,
  outline: [
    { id: "section-a", title: "先看选择", goal: "建立直觉", recommendedWords: 500, order: 0 },
    { id: "section-b", title: "解释取舍", goal: "解释概念", recommendedWords: 500, order: 1 }
  ]
};

type CompleteFn = Pick<OpenAiJsonClient, "complete">["complete"];

/**
 * 模拟真实 JsonClient 的行为契约：schema（mock 里略过）之后执行 validate 钩子，
 * 语义不合规就抛与 openai-json-client 同款的错误文案。
 * 合法值测试也走它——否则「语义校验放行合法结果」这条根本没被测到。
 * 不用 vi.fn：它对泛型函数的类型推导会退化成 unknown。
 */
function fakeClient(payload: unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const complete: CompleteFn = async (request) => {
    calls.push(request as unknown as Record<string, unknown>);
    const validate = request.validate as ((result: unknown) => string | null) | undefined;
    if (validate) {
      const complaint = validate(payload);
      if (complaint) throw new Error(`语言模型服务返回了无效结果（${complaint}），请稍后重试。`);
    }
    return payload as never;
  };
  return { complete, calls };
}

/** 同 fakeClient，但按调用次序依次返回多个载荷（模拟一次坏、一次好的重试序列）。 */
function fakeQueuedClient(payloads: unknown[]) {
  const queue = [...payloads];
  const calls: Array<Record<string, unknown>> = [];
  const complete: CompleteFn = async (request) => {
    calls.push(request as unknown as Record<string, unknown>);
    const payload = queue.shift();
    if (!payload) throw new Error("fake client ran out of payloads");
    const validate = request.validate as ((result: unknown) => string | null) | undefined;
    if (validate) {
      const complaint = validate(payload);
      if (complaint) throw new Error(`语言模型服务返回了无效结果（${complaint}），请稍后重试。`);
    }
    return payload as never;
  };
  return { complete, calls };
}

describe("OpenAiOutlineReviewer", () => {
  it("accepts a passed independent review without source context only when source support is null", async () => {
    const { complete, calls } = fakeClient({
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
    expect(calls[0]).toMatchObject({
      timeoutMs: 180_000,
      systemPrompt: expect.stringContaining("status")
    });
  });

  it("rejects a review issue that cites a section outside the input outline", async () => {
    const { complete } = fakeClient({
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

    // 语义校验失败走 client 的纠错重试通道，最终报错带具体问题而不是一句空话。
    await expect(reviewer.review(reviewInput)).rejects.toThrow("sectionKey");
  });

  it("accepts a needs-revision review that cites an input section", async () => {
    const { complete } = fakeClient({
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
    const { complete } = fakeClient({
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
    const { complete } = fakeClient({
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

    await expect(reviewer.review(reviewInput)).rejects.toThrow("blocking");
  });

  it("accepts a blocked review with a blocking issue and rejects source support without sources", async () => {
    const { complete } = fakeQueuedClient([
      {
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
      },
      {
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
      }
    ]);
    const reviewer = new OpenAiOutlineReviewer({ complete });

    await expect(reviewer.review(reviewInput)).resolves.toMatchObject({ status: "blocked" });
    await expect(reviewer.review(reviewInput)).rejects.toThrow("sourceSupport");
  });
});
