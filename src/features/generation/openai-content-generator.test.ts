import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBrief, OutlineSection } from "@/features/articles/domain";
import { OpenAiContentGenerator } from "./openai-content-generator";
import { generatedArticleContentSchema } from "./schemas";

const brief: KnowledgeBrief = {
  oneSentence: "机会成本是为了一个选择而放弃的最佳替代选择。",
  concepts: ["选择", "取舍"],
  prerequisites: [],
  misconceptions: ["机会成本只等于花出去的钱"],
  analogies: ["在两个周末安排中只能选择一个"],
  unsupportedNotes: []
};

const outline: OutlineSection[] = [
  { id: "section-intuition", title: "先建立取舍直觉", goal: "用熟悉选择建立直觉", recommendedWords: 450, order: 0 },
  { id: "section-definition", title: "给机会成本下定义", goal: "解释概念和边界", recommendedWords: 550, order: 1 }
];

const generatedArticle = {
  title: "用生活选择理解机会成本",
  blocks: [
    { id: "block-1", type: "heading", content: "用生活选择理解机会成本", level: 1, order: 0, version: 1 },
    { id: "block-2", type: "heading", content: "先建立取舍直觉", level: 2, order: 1, version: 1 },
    { id: "block-3", type: "paragraph", content: "当你把周末留给一件事，就放弃了另一个同样有价值的安排。", order: 2, version: 1 },
    { id: "block-4", type: "callout", content: "关键不是是否花钱，而是放弃了什么。", order: 3, version: 1 },
    { id: "block-5", type: "heading", content: "给机会成本下定义", level: 2, order: 4, version: 1 },
    { id: "block-6", type: "paragraph", content: "机会成本关注的是你没有选择的最佳替代方案。", order: 5, version: 1 }
  ]
} as const;

describe("OpenAiContentGenerator", () => {
  it("forwards the selected model and confirmed outline context while returning canonical blocks", async () => {
    const complete = vi.fn().mockResolvedValue(generatedArticle);
    const generator = new OpenAiContentGenerator({ complete });

    await expect(generator.generate({
      topic: "机会成本",
      brief,
      outline,
      lengthPreset: "standard",
      sourceContext: "【课堂笔记】\n机会成本是放弃的最佳替代方案。",
      model: "writer-large"
    })).resolves.toEqual(generatedArticle);

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "writer-large",
      schema: generatedArticleContentSchema,
      timeoutMs: 600_000,
      systemPrompt: expect.stringContaining("已确认的大纲"),
      userPayload: {
        topic: "机会成本",
        brief,
        confirmedOutline: outline,
        lengthPreset: "standard",
        sourceContext: "【课堂笔记】\n机会成本是放弃的最佳替代方案。"
      }
    }));
    expect(generatedArticle.blocks.map((block) => block.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(generatedArticle.blocks.every((block) => block.version === 1)).toBe(true);
  });

  it("rejects image blocks and blocks without content in the strict JSON schema", () => {
    expect(generatedArticleContentSchema.safeParse({
      ...generatedArticle,
      blocks: [{ ...generatedArticle.blocks[0], type: "image" }]
    }).success).toBe(false);

    expect(generatedArticleContentSchema.safeParse({
      ...generatedArticle,
      blocks: [{ ...generatedArticle.blocks[0], content: "" }]
    }).success).toBe(false);

    expect(generatedArticleContentSchema.safeParse({
      ...generatedArticle,
      blocks: [{ ...generatedArticle.blocks[0], version: 2 }]
    }).success).toBe(false);
  });

  it("rejects a completion whose blocks are not returned in sequential order", async () => {
    const complete = vi.fn().mockResolvedValue({
      ...generatedArticle,
      blocks: generatedArticle.blocks.map((block, index) => ({
        ...block,
        order: index === 1 ? 3 : block.order
      }))
    });
    const generator = new OpenAiContentGenerator({ complete });

    await expect(generator.generate({ topic: "机会成本", brief, outline, lengthPreset: "standard" })).rejects.toThrow(
      "正文生成结果不符合要求"
    );
  });

  it("rejects a completion that omits a confirmed outline section", async () => {
    const complete = vi.fn().mockResolvedValue({
      ...generatedArticle,
      blocks: [
        generatedArticle.blocks[0],
        { ...generatedArticle.blocks[2], order: 1 }
      ]
    });
    const generator = new OpenAiContentGenerator({ complete });

    await expect(generator.generate({ topic: "机会成本", brief, outline, lengthPreset: "standard" })).rejects.toThrow(
      "正文生成结果不符合要求"
    );
  });

  it("rejects a completion that reorders confirmed outline section headings", async () => {
    const complete = vi.fn().mockResolvedValue({
      ...generatedArticle,
      blocks: generatedArticle.blocks.map((block) => {
        if (block.content === "先建立取舍直觉") return { ...block, content: "给机会成本下定义" };
        if (block.content === "给机会成本下定义") return { ...block, content: "先建立取舍直觉" };
        return block;
      })
    });
    const generator = new OpenAiContentGenerator({ complete });

    await expect(generator.generate({ topic: "机会成本", brief, outline, lengthPreset: "standard" })).rejects.toThrow(
      "正文生成结果不符合要求"
    );
  });

  it("allows the first level-one article title heading when it equals a confirmed section title", async () => {
    const complete = vi.fn().mockResolvedValue({
      ...generatedArticle,
      title: outline[0].title,
      blocks: generatedArticle.blocks.map((block, index) => index === 0
        ? { ...block, content: outline[0].title }
        : block)
    });
    const generator = new OpenAiContentGenerator({ complete });

    await expect(generator.generate({ topic: "机会成本", brief, outline, lengthPreset: "standard" })).resolves.toEqual({
      ...generatedArticle,
      title: outline[0].title,
      blocks: generatedArticle.blocks.map((block, index) => index === 0
        ? { ...block, content: outline[0].title }
        : block)
    });
  });
});
