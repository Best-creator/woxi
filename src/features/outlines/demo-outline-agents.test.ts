import { describe, expect, it } from "vitest";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "./demo-outline-agents";

describe("demo outline agents", () => {
  it("generates a deterministic legal outline and a passed review", async () => {
    const generator = new DemoOutlineGenerator();
    const outline = await generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 }
    });
    const reviewer = new DemoOutlineReviewer();
    const review = await reviewer.review({ topic: "机会成本", outline: outline.outline });

    expect(outline.recommendedTotalWords).toBe(1_000);
    expect(outline.outline.map((section) => section.key)).toEqual([
      "start_with_a_choice",
      "name_the_tradeoff",
      "use_it_in_daily_decisions"
    ]);
    expect(review).toMatchObject({ status: "passed", issues: [] });
  });

  it("honors a legal narrow word range", async () => {
    const generator = new DemoOutlineGenerator();

    const outline = await generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 850, max: 900 }
    });

    expect(outline.recommendedTotalWords).toBeGreaterThanOrEqual(850);
    expect(outline.recommendedTotalWords).toBeLessThanOrEqual(900);
    expect(outline.outline.every((section) => section.recommendedWords >= 50)).toBe(true);
    expect(outline.outline.reduce((total, section) => total + section.recommendedWords, 0))
      .toBe(outline.recommendedTotalWords);
  });

  it("reports source support when source context is available", async () => {
    const reviewer = new DemoOutlineReviewer();

    const review = await reviewer.review({
      topic: "机会成本",
      sourceContext: "机会成本是被放弃的最佳替代选择。",
      outline: [
        { id: "section-a", title: "先看选择" },
        { id: "section-b", title: "解释取舍" }
      ]
    });

    expect(review.sourceSupport).toBe(5);
  });

  it("changes the opening section when applying review feedback", async () => {
    const generator = new DemoOutlineGenerator();
    const original = await generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 }
    });
    const revised = await generator.generate({
      topic: "机会成本",
      targetAudience: "零基础读者",
      lengthPreset: "short",
      wordRange: { min: 800, max: 1200 },
      currentOutline: original.outline,
      reviewFeedback: {
        status: "needs_revision",
        summary: "章节目标不够具体。",
        issues: [{ sectionKey: "start_with_a_choice", severity: "warning", message: "请用更日常的例子开场。" }]
      }
    });

    expect(revised.outline[0]?.title).not.toBe(original.outline[0]?.title);
    expect(revised.brief.oneSentence).not.toBe(original.brief.oneSentence);
  });
});
