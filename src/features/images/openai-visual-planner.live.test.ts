// @vitest-environment node

/**
 * 真实模型上的「配图提示词」验收。
 *
 * mock/Demo 只能证明接线正确，证明不了提示词有效——「模型有没有把纯白底写进每一格」
 * 这类问题只有真跑才会暴露。默认跳过，需要显式开启：
 *
 *   WO_XI_LIVE_LLM=1 ./node_modules/.bin/vitest run src/features/images/openai-visual-planner.live.test.ts
 *
 * 会真实调用一次视觉规划，并打印每格的 prompt 供人工核对。
 */

import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import { getServerConfig } from "@/server/config";
import { OpenAiVisualPlanner } from "./openai-visual-planner";

const LIVE = process.env.WO_XI_LIVE_LLM === "1";
const llm = getServerConfig().llm;

/** 一格标题 + 一句文案，正是漫画预设产生的形状。 */
const BLOCKS: ContentBlock[] = [
  { id: "h1", type: "heading", content: "第一格：眼睛为什么会酸", order: 0, level: 2, version: 1 },
  { id: "p1", type: "paragraph", content: "盯着屏幕时眨眼次数掉了一半。", order: 1, version: 1 },
  { id: "h2", type: "heading", content: "第二格：眨眼少了会怎样", order: 2, level: 2, version: 1 },
  { id: "p2", type: "paragraph", content: "泪膜撑不住，眼睛就开始报警。", order: 3, version: 1 },
  { id: "h3", type: "heading", content: "第三格：怎么救", order: 4, level: 2, version: 1 },
  { id: "p3", type: "paragraph", content: "二十分钟看远处二十秒。", order: 5, version: 1 }
];

/**
 * 故意给一个底色是「米黄纸纹」的风格。
 * 它和「配图必须纯白底」的硬规则**直接冲突**，用来验证硬规则能覆盖风格里的背景描述——
 * 这正是漫画长图能连成一张纸的前提，也是风格库那条已知冲突的现场。
 */
const BEIGE_STYLE = [
  "【画风】Q版手绘科普卡片风格",
  "【主色板】#E8DCC0 #C4A46B #7A6A4F",
  "【线条】不均匀抖动细描边",
  "【角色造型】两头身圆脸角色",
  "【构图】单主体居中，四周留白",
  "【背景】米黄纸纹底，轻微颗粒质感",
  "【文字排版】手写体标题，位置随意",
  "【风格概括】温暖治愈的纸质科普卡片"
].join("\n");

/** 同义词放宽：模型换个说法也算数，只要明确要求了「白」。 */
const WHITE_BACKGROUND = /纯白|白色|白底|净白|素白|白背景|#\s*fff|#\s*ffffff/i;

describe.skipIf(!LIVE || !llm)("live visual prompt", () => {
  it("asks for a pure white background even when the style asks for paper texture", async () => {
    const model = llm!.visualModel || llm!.model;
    const planner = new OpenAiVisualPlanner({
      baseUrl: llm!.baseUrl,
      apiKey: llm!.apiKey,
      model
    });

    const plan = await planner.plan({
      title: "眼睛为什么会酸",
      topic: "护眼",
      blocks: BLOCKS,
      style: BEIGE_STYLE,
      model
    });

    console.log(
      JSON.stringify(
        {
          model,
          count: plan.suggestions.length,
          stripDecision: plan.stripDecision,
          panels: plan.suggestions.map((suggestion) => ({
            type: suggestion.type,
            purpose: suggestion.purpose,
            mentionsWhiteBackground: WHITE_BACKGROUND.test(suggestion.prompt),
            prompt: suggestion.prompt
          }))
        },
        null,
        2
      )
    );

    const storyboards = plan.suggestions.filter((suggestion) => suggestion.type === "storyboard");
    expect(storyboards.length).toBeGreaterThan(0);
    // 白底必须落在每一格的 prompt 里：一格不白，拼出来的长图就会露出一块别的颜色。
    const missing = storyboards.filter((panel) => !WHITE_BACKGROUND.test(panel.prompt));
    expect(missing.map((panel) => panel.purpose)).toEqual([]);
  }, 300_000);
});
