import type {
  GeneratedOutline,
  GenerateOutlineInput,
  OutlineReviewResult,
  ReviewOutlineInput
} from "./domain";
import type { OutlineGenerator, OutlineReviewer } from "./ports";

function preferredTotalWords(input: GenerateOutlineInput) {
  switch (input.lengthPreset) {
    case "brief":
      return 600;
    case "short":
      return 1_000;
    case "standard":
      return 1_200;
    case "deep":
      return 1_700;
  }
}

function totalWords(input: GenerateOutlineInput) {
  const preferred = preferredTotalWords(input);
  return Math.max(input.wordRange.min, Math.min(preferred, input.wordRange.max));
}

function sectionWords(total: number) {
  const first = Math.floor(total * 0.35);
  const second = Math.floor(total * 0.35);
  return [first, second, total - first - second];
}

export class DemoOutlineGenerator implements OutlineGenerator {
  async generate(input: GenerateOutlineInput): Promise<GeneratedOutline> {
    const total = totalWords(input);
    const [opening, explanation, application] = sectionWords(total);
    // 只要有修订意图就产出「修订版」结构：只带 userInstructions、没有审核意见时也一样。
    const revising = Boolean(input.reviewFeedback || input.userInstructions);
    return {
      workingTitle: revising ? `用日常选择理解${input.topic}` : `理解${input.topic}`,
      recommendedTotalWords: total,
      brief: {
        oneSentence: revising
          ? `每个关于${input.topic}的选择，都会放弃别的可能。`
          : `${input.topic}可以帮助读者更清楚地理解日常选择。`,
        concepts: [input.topic, "选择与取舍"],
        prerequisites: input.reviewFeedback?.hiddenPrerequisites ?? [],
        misconceptions: ["只要记住定义就算真正理解。"],
        analogies: revising
          ? ["在两个周末安排中只能选择一个。"]
          : ["在有限时间内安排最重要的事情。"],
        unsupportedNotes: input.sourceContext?.trim()
          ? []
          : ["未提供资料来源，涉及事实性表述时需要人工核验。"]
      },
      outline: [
        {
          key: revising ? "start_with_a_daily_choice" : "start_with_a_choice",
          title: revising ? "先从一个日常选择说起" : "先看一个熟悉的选择",
          goal: revising ? "用更日常的例子建立直觉。" : "通过日常场景建立直觉。",
          recommendedWords: opening
        },
        {
          key: "name_the_tradeoff",
          title: "给取舍一个清楚的名字",
          goal: `解释${input.topic}的核心含义和边界。`,
          recommendedWords: explanation
        },
        {
          key: "use_it_in_daily_decisions",
          title: "把理解用回日常决策",
          goal: "用简单步骤识别并比较不同选择。",
          recommendedWords: application
        }
      ]
    };
  }
}

export class DemoOutlineReviewer implements OutlineReviewer {
  async review(input: ReviewOutlineInput): Promise<OutlineReviewResult> {
    return {
      status: "passed",
      summary: "大纲覆盖从直觉到应用的必要路径，适合零基础读者。",
      coverage: 5,
      granularity: 5,
      beginnerFriendliness: 5,
      logicalOrder: 5,
      sourceSupport: input.sourceContext?.trim() ? 5 : null,
      hiddenPrerequisites: [],
      complexDependencies: [],
      issues: []
    };
  }
}
