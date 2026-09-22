import { describe, expect, it } from "vitest";
import { generatedOutlineSchema, outlineReviewResultSchema } from "./schemas";

describe("generated outline schema", () => {
  it("normalizes Gemini-style brief and section fields", () => {
    const result = generatedOutlineSchema.safeParse({
      brief: {
        topic: "一天为什么是24小时？",
        targetAudience: "对天文与历法历史零基础的普通读者",
        recommendedWordCount: { min: 1000, max: 1500 },
        coreMessage: "24小时是自然周期与人类约定共同形成的时间刻度。",
        prerequisites: ["了解地球自转"],
        commonMisconceptions: ["24小时是物理常数"],
        unsupportedNotes: ["需要核验历史先后"],
        analogies: []
      },
      sections: [
        {
          sectionNumber: 1,
          title: "先区分自然周期和人造刻度",
          intuitiveHook: "为什么不用十进制计时？",
          keyPoints: ["天来自地球自转", "小时是人为划分"],
          terminologyToIntroduce: ["自然周期"],
          intendedWordCount: 500
        },
        {
          sectionNumber: 2,
          title: "24小时的历史来源",
          intuitiveHook: "古人如何观察昼夜？",
          keyPoints: ["昼夜各分为12份"],
          terminologyToIntroduce: ["十二进制"],
          intendedWordCount: 500
        }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        workingTitle: "一天为什么是24小时？",
        recommendedTotalWords: 1000,
        brief: {
          oneSentence: "24小时是自然周期与人类约定共同形成的时间刻度。",
          concepts: expect.arrayContaining(["自然周期"]),
          misconceptions: ["24小时是物理常数"]
        },
        outline: [
          { key: "section-1", goal: "为什么不用十进制计时？", recommendedWords: 500 },
          { key: "section-2", goal: "古人如何观察昼夜？", recommendedWords: 500 }
        ]
      });
    }
  });

  it("normalizes a canonical outline with Gemini-style brief fields", () => {
    const result = generatedOutlineSchema.safeParse({
      workingTitle: "一天为什么是24小时？",
      recommendedTotalWords: 1000,
      brief: {
        topic: "一天为什么是24小时？",
        coreMessage: "24小时是人类对一天的约定性划分。",
        prerequisites: [],
        commonMisconceptions: ["24小时是自然常数"],
        unsupportedNotes: []
      },
      outline: [
        { key: "history", title: "历史来源", goal: "解释来源", recommendedWords: 500 },
        { key: "standard", title: "标准化", goal: "解释固定时长", recommendedWords: 500 }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brief.oneSentence).toBe("24小时是人类对一天的约定性划分。");
      expect(result.data.brief.misconceptions).toEqual(["24小时是自然常数"]);
    }
  });

  it("keeps the storyline verbatim when the model provides one", () => {
    const result = generatedOutlineSchema.safeParse({
      workingTitle: "一天为什么是24小时？",
      storyline: "从一个人看表迟到讲起，让读者先意识到「一天多长」是被定义出来的；再切到地球自转的现场，讲自然周期；最后回到历法史，看人类怎么把这一天切成24份，收在钟表统一时间的那一幕。",
      recommendedTotalWords: 1000,
      brief: {
        topic: "一天为什么是24小时？",
        coreMessage: "24小时是人类对一天的约定性划分。",
        prerequisites: [],
        commonMisconceptions: [],
        unsupportedNotes: []
      },
      outline: [
        { key: "history", title: "历史来源", goal: "解释来源", recommendedWords: 500 },
        { key: "standard", title: "标准化", goal: "解释固定时长", recommendedWords: 500 }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.storyline).toContain("看表迟到");
    }
  });

  it("accepts storyline field-name variants and falls back to joined goals", () => {
    const result = generatedOutlineSchema.safeParse({
      workingTitle: "一天为什么是24小时？",
      storyLine: "先看一个迟到的早晨，再拆开地球自转，最后看人类把一天切成24份的历史。",
      recommendedTotalWords: 1000,
      brief: {
        topic: "一天为什么是24小时？",
        coreMessage: "24小时是人类对一天的约定性划分。",
        prerequisites: [],
        commonMisconceptions: [],
        unsupportedNotes: []
      },
      outline: [
        { key: "history", title: "历史来源", goal: "解释来源", recommendedWords: 500 },
        { key: "standard", title: "标准化", goal: "解释固定时长", recommendedWords: 500 }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.storyline).toContain("迟到的早晨");
    }

    const fallback = generatedOutlineSchema.safeParse({
      workingTitle: "一天为什么是24小时？",
      recommendedTotalWords: 1000,
      brief: {
        topic: "一天为什么是24小时？",
        coreMessage: "24小时是人类对一天的约定性划分。",
        prerequisites: [],
        commonMisconceptions: [],
        unsupportedNotes: []
      },
      outline: [
        { key: "history", title: "历史来源", goal: "先看一个迟到的早晨，引出时间被定义这件事。", recommendedWords: 500 },
        { key: "standard", title: "标准化", goal: "再讲人类把一天切成24份的历史。", recommendedWords: 500 }
      ]
    });

    expect(fallback.success).toBe(true);
    if (fallback.success) {
      expect(fallback.data.storyline).toContain("迟到的早晨");
      expect(fallback.data.storyline).toContain("切成24份");
    }
  });
});

describe("outline review schema", () => {
  it("normalizes Gemini-style review scores and issue fields", () => {
    const result = outlineReviewResultSchema.safeParse({
      recommendation: "needs_revision",
      overallAssessment: "整体逻辑清楚，但部分历史因果需要补充。",
      scores: {
        coverage: 4,
        granularity: 4,
        beginnerFriendliness: 5,
        logicalOrder: 4,
        sourceSupport: 3
      },
      missingPrerequisites: ["需要理解太阳日"],
      complexConcepts: ["古代历法演变"],
      issues: [{ sectionNumber: 2, severity: "warning", description: "补充证据来源。" }]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        status: "needs_revision",
        summary: "整体逻辑清楚，但部分历史因果需要补充。",
        coverage: 4,
        hiddenPrerequisites: ["需要理解太阳日"],
        complexDependencies: ["古代历法演变"],
        issues: [{ sectionKey: "section-2", message: "补充证据来源。" }]
      });
    }
  });
});
