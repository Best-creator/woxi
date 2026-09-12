import { describe, expect, it, vi } from "vitest";
import { OpenAiOutlineGenerator } from "./openai-outline-generator";

const validOutline = {
  workingTitle: "理解机会成本",
  recommendedTotalWords: 1_000,
  brief: {
    oneSentence: "机会成本是为了一个选择而放弃的最佳替代选择。",
    concepts: ["稀缺", "选择"],
    prerequisites: [],
    misconceptions: ["机会成本只等于花出去的钱"],
    analogies: ["在两个周末安排中只能选择一个"],
    unsupportedNotes: []
  },
  outline: [
    { key: "start_with_a_choice", title: "先看一个选择", goal: "建立直觉", recommendedWords: 500 },
    { key: "name_the_tradeoff", title: "给取舍命名", goal: "解释概念", recommendedWords: 500 }
  ]
};

describe("OpenAiOutlineGenerator", () => {
  it("sends the requested model and returns a valid outline within the selected range", async () => {
    const complete = vi.fn().mockResolvedValue(validOutline);
    const generator = new OpenAiOutlineGenerator({ complete });

    const result = await generator.generate({
      topic: "机会成本",
      targetAudience: "对该知识点零基础的普通读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 },
      sourceContext: "机会成本是放弃的最佳替代方案。",
      model: "grok-4.6"
    });

    expect(result).toEqual(validOutline);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "grok-4.6",
      timeoutMs: 600_000,
      userPayload: expect.objectContaining({
        topic: "机会成本",
        wordRange: { min: 800, max: 1200 }
      }),
      systemPrompt: expect.stringContaining("workingTitle")
    }));
  });

  it("rejects duplicate section keys from an otherwise valid model response", async () => {
    const complete = vi.fn().mockResolvedValue({
      ...validOutline,
      outline: [
        validOutline.outline[0],
        { ...validOutline.outline[1], key: validOutline.outline[0].key }
      ]
    });
    const generator = new OpenAiOutlineGenerator({ complete });

    await expect(generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 }
    })).rejects.toThrow("大纲生成结果不符合要求");
  });

  it("rejects a no-source outline without unsupported notes", async () => {
    const complete = vi.fn().mockResolvedValue(validOutline);
    const generator = new OpenAiOutlineGenerator({ complete });

    await expect(generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 }
    })).rejects.toThrow("大纲生成结果不符合要求");
  });

  it("asks the model to revise from review feedback instead of generating from scratch", async () => {
    const complete = vi.fn().mockResolvedValue(validOutline);
    const generator = new OpenAiOutlineGenerator({ complete });

    await generator.generate({
      topic: "机会成本",
      targetAudience: "对该知识点零基础的普通读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 },
      sourceContext: "机会成本是放弃的最佳替代方案。",
      currentBrief: validOutline.brief,
      currentOutline: validOutline.outline,
      reviewFeedback: {
        status: "needs_revision",
        summary: "章节目标不够具体。",
        issues: [{ sectionKey: "start_with_a_choice", severity: "warning", message: "请用更日常的例子开场。" }]
      },
      model: "grok-4.6"
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining("根据审核意见修订"),
      userPayload: expect.objectContaining({
        reviewFeedback: expect.objectContaining({ status: "needs_revision" }),
        currentOutline: validOutline.outline
      })
    }));
  });
});
