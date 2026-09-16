// @vitest-environment node

/**
 * 真实模型上的大纲修订提示词验收。
 *
 * 「补充要求」这条链路只有真跑才能验证：模型是否真的把作者的话落到章节标题上、
 * 是否还在硬约束（章节数、字数吻合、key 唯一）内，mock 全都测不出来。
 * 默认跳过，需要显式开启：
 *
 *   WO_XI_LIVE_LLM=1 node node_modules/vitest/vitest.mjs run --reporter=verbose \
 *     src/features/outlines/openai-outline-generator.live.test.ts
 */

import { describe, expect, it } from "vitest";
import { LENGTH_RANGES } from "@/features/articles/domain";
import { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { getServerConfig } from "@/server/config";
import { OpenAiOutlineGenerator } from "./openai-outline-generator";

const LIVE = process.env.WO_XI_LIVE_LLM === "1";
const llm = getServerConfig().llm;

const LENGTH_PRESET = "standard" as const;

const CURRENT_BRIEF = {
  oneSentence: "久坐的代价不在当下的酸痛，而在被长期打断的循环与代谢。",
  concepts: ["静态负荷", "静脉回流", "椎间盘压力"],
  prerequisites: ["知道心脏负责泵血"],
  misconceptions: ["只要不疼就说明没问题"],
  analogies: ["椅子在按小时悄悄收费"],
  unsupportedNotes: []
};

const CURRENT_OUTLINE = [
  {
    key: "opening_scene",
    title: "开场：下午三点，你又一次瘫在椅子上",
    goal: "用办公室场景建立代入感，让读者认出自己",
    recommendedWords: 300
  },
  {
    key: "what_chair_does",
    title: "椅子上到底发生了什么",
    goal: "一次讲完循环、肌肉和椎间盘三件事",
    recommendedWords: 400
  },
  {
    key: "why_no_pain",
    title: "为什么你感觉不到",
    goal: "解释身体信号的延迟",
    recommendedWords: 300
  },
  {
    key: "action_floor",
    title: "最低成本能做点什么",
    goal: "给出可执行的换姿势频率",
    recommendedWords: 400
  }
];

const USER_INSTRUCTIONS = "把「椅子上到底发生了什么」拆成两节，循环一节、腰椎一节，各自讲透；开场不要用下午三点瘫在椅子上这个场景，换成早高峰地铁上站着的对比。";

describe.skipIf(!LIVE || !llm)("live outline revision prompt", () => {
  it("turns the author's instructions into outline sections without breaking the hard constraints", async () => {
    const generator = new OpenAiOutlineGenerator(new OpenAiJsonClient(llm!));

    const result = await generator.generate({
      topic: "久坐那张椅子到底在收你什么费",
      targetAudience: "每天坐办公室八小时以上、习惯性腰酸的上班族",
      lengthPreset: LENGTH_PRESET,
      wordRange: LENGTH_RANGES[LENGTH_PRESET],
      sourceContext:
        "久坐会显著降低下肢静脉回流效率，并使椎间盘承受的压力高于站立时；身体对慢性静态负荷的痛觉反馈通常有明显延迟。",
      currentBrief: CURRENT_BRIEF,
      currentOutline: CURRENT_OUTLINE,
      userInstructions: USER_INSTRUCTIONS,
      model: llm!.model
    });

    const report = {
      model: llm!.model,
      instructions: USER_INSTRUCTIONS,
      workingTitle: result.workingTitle,
      recommendedTotalWords: result.recommendedTotalWords,
      sections: result.outline.map((section) => ({
        key: section.key,
        title: section.title,
        recommendedWords: section.recommendedWords
      })),
      sumOfSectionWords: result.outline.reduce((total, section) => total + section.recommendedWords, 0),
      // 人工核对用：模型有没有真的把「拆成两节」「换开场」听进去。
      // 两个坑：（1）别用单一词判断——模型写「血液回流」时不会出现「循环」两字，
      // 所以要给一组同义说法；（2）别拿章节 key 判断——key 是模型自拟的，
      // 首轮跑出 circulation_cost，次轮就跑成 circulation_stall，按 key 判定纯属自找误报。
      keptOldOpening: result.outline.some((section) => section.title.includes("瘫在椅子上")),
      coversCirculation: /循环|血流|血液|回流|静脉/.test(JSON.stringify(result.outline)),
      coversSpine: /腰椎|椎间盘|脊椎/.test(JSON.stringify(result.outline))
    };
    console.log(JSON.stringify(report, null, 2));

    // 硬约束：拆分会增加章节数，但区间与字数吻合仍必须成立。
    expect(result.outline.length).toBeGreaterThanOrEqual(CURRENT_OUTLINE.length + 1);
    expect(new Set(result.outline.map((section) => section.key)).size).toBe(result.outline.length);
    expect(result.recommendedTotalWords).toBeGreaterThanOrEqual(LENGTH_RANGES[LENGTH_PRESET].min);
    expect(result.recommendedTotalWords).toBeLessThanOrEqual(LENGTH_RANGES[LENGTH_PRESET].max);

    // 软约束（这才是「模型听懂了」的证据）：作者点名要换掉的场景不该再出现，
    // 而他要拆出来的两条线都得在结构里有位置。
    // 只断言语义、不断言 key：章节 key 由模型自拟，沿用旧 key 不是它能被要求的义务。
    expect(report.keptOldOpening).toBe(false);
    expect(report.coversCirculation).toBe(true);
    expect(report.coversSpine).toBe(true);
  }, 600_000);
});
