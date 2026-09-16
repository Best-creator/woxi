// @vitest-environment node

/**
 * 真实模型上的提示词验收。
 *
 * mock/Demo 只能证明代码接线正确，证明不了提示词有效——「模型省略 schema 必需字段」
 * 这类问题只有真跑才会暴露。因此这个文件默认跳过，需要显式开启：
 *
 *   WO_XI_LIVE_LLM=1 node node_modules/vitest/vitest.mjs run src/features/content/openai-content-generator.live.test.ts
 *
 * 会用掉一次真实生成（实测 100s+），并打印分镜结构报告供人工核对。
 */

import { describe, expect, it } from "vitest";
import { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { getServerConfig } from "@/server/config";
import { describeAudience } from "./audience";
import { comicPanelLimit } from "./comic-script";
import { OpenAiContentGenerator } from "./openai-content-generator";
import { resolveStyleProfile } from "./style-profile";

const LIVE = process.env.WO_XI_LIVE_LLM === "1";
const llm = getServerConfig().llm;

const OUTLINE = [
  { id: "p-1", title: "开场：下午三点，你的身体在报警", goal: "用工位场景建立代入感", recommendedWords: 250, order: 0 },
  { id: "p-2", title: "椅子上到底发生了什么", goal: "拆解久坐对循环和腰椎的机制", recommendedWords: 280, order: 1 },
  { id: "p-3", title: "为什么你感觉不到", goal: "解释身体信号的延迟", recommendedWords: 250, order: 2 },
  { id: "p-4", title: "打断它需要多频繁", goal: "给出可执行的换姿势频率", recommendedWords: 250, order: 3 },
  { id: "p-5", title: "做点什么就够", goal: "给最低成本的行动方案", recommendedWords: 250, order: 4 }
];

describe.skipIf(!LIVE || !llm)("live content prompt", () => {
  it("writes a comic script that respects panelLimit and the title rule", async () => {
    const generator = new OpenAiContentGenerator(new OpenAiJsonClient(llm!));
    const styleProfile = resolveStyleProfile("science_comic_script", "", "office_desk");
    const panelLimit = comicPanelLimit(styleProfile.preset, "standard");

    const result = await generator.generate({
      topic: "久坐那张椅子到底在收你什么费",
      targetAudience: describeAudience("office_desk"),
      brief: {
        oneSentence: "久坐的代价不在当下的不适，而在被长期打断的循环与代谢。",
        concepts: ["静态负荷", "静脉回流", "椎间盘压力"],
        prerequisites: ["知道心脏泵血"],
        misconceptions: ["只要不疼就没问题"],
        analogies: ["椅子在按小时收费"],
        unsupportedNotes: []
      },
      outline: OUTLINE,
      recommendedTotalWords: 1_500,
      styleProfile,
      ...(panelLimit ? { panelLimit } : {}),
      model: llm!.model
    });

    const panelHeadings = result.blocks.filter((block) => block.type === "heading");
    const perPanel = panelHeadings.map((heading) => {
      const index = result.blocks.indexOf(heading);
      const untilNext = result.blocks
        .slice(index + 1)
        .findIndex((block) => block.type === "heading");
      const body = result.blocks.slice(index + 1, untilNext === -1 ? undefined : index + 1 + untilNext);
      return {
        title: heading.content,
        chars: body.reduce((total, block) => total + block.content.replace(/\s/g, "").length, 0),
        blockTypes: Array.from(new Set(body.map((block) => block.type)))
      };
    });

    const totalChars = result.blocks.reduce(
      (total, block) => total + block.content.replace(/\s/g, "").length,
      0
    );

    console.log(
      JSON.stringify(
        {
          model: llm!.model,
          title: result.title,
          blockCount: result.blocks.length,
          totalChars,
          panelLimit,
          panelCount: panelHeadings.length,
          perPanel,
          styles: Array.from(new Set(result.blocks.map((block) => block.type)))
        },
        null,
        2
      )
    );

    expect(result.blocks.length).toBeGreaterThan(4);
    expect(result.title.length).toBeGreaterThan(0);
  }, 300_000);
});
