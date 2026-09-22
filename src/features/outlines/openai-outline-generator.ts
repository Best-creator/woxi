import { LENGTH_RANGES } from "@/features/articles/domain";
import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { GeneratedOutline, GenerateOutlineInput } from "./domain";
import type { OutlineGenerator } from "./ports";
import { generatedOutlineSchema } from "./schemas";

export const OUTLINE_GENERATOR_SYSTEM_PROMPT = `你是面向普通读者的知识纲要生成器。只返回 JSON，不要 Markdown、解释或正文内容块。
返回对象必须严格使用以下字段名：
{"workingTitle":"文章标题","recommendedTotalWords":1200,"brief":{"oneSentence":"一句话核心解释","concepts":["概念"],"prerequisites":["前置知识"],"misconceptions":["常见误区"],"analogies":["类比"],"unsupportedNotes":["需要核验的事实"]},"outline":[{"key":"section_key","title":"章节标题","goal":"叙事蓝图：用什么具体画面或情境开场→讲清什么→结尾抛出什么问题或悬念勾住下一节（40-80 字）","recommendedWords":300}]}
其中 outline 至少 2 个章节；key 只能包含小写字母、数字、下划线或连字符；recommendedTotalWords 和 recommendedWords 必须是整数。读者是零基础普通读者：先建立直觉，再引入术语；识别需要的前置知识和常见误区；为讲清楚概念推荐足够但不臃肿的字数。
goal 是叙事蓝图，不是知识点标签：禁止只写「介绍 XX」「讲清 XX」这类概括——要写出这一节怎么开场（具体的人/事/画面）、讲什么（一条因果链）、末尾留什么钩子（一个没答完的问题或一句反常的话；末节写怎么收束）。相邻章节的钩子与开场必须咬合：上一节抛出的问题，下一节的开场要接住它，整篇读起来是一部有起承转合的短篇，不是一摞互相独立的卡片。
没有资料时，必须在 brief.unsupportedNotes 中写明需要人工核验的事实。只生成 brief 与章节纲要，绝不生成文章正文块。`;

export const OUTLINE_REVISION_SYSTEM_PROMPT = `${OUTLINE_GENERATOR_SYSTEM_PROMPT}
如果输入包含 currentOutline 和 currentBrief，必须在它们的基础上修订，而不是从零另起一份无关结构；保留仍然有效的章节意图。
输入可能出现两类修改要求，出现的都要逐条处理：
- reviewFeedback：审核模型发现的问题。逐条处理 issues、hiddenPrerequisites 和 complexDependencies。
- userInstructions：作者本人用自然语言写的修改要求。它是最高优先级的意图来源，必须优先满足：
  作者点名要保留、删除、拆分、合并或调整顺序的章节，照做；作者描述的场景、例子和侧重点，落到对应章节的 title 与 goal 上。
两类要求互相冲突时，以 userInstructions 为准。
无论哪一类要求，都不得突破硬约束：recommendedTotalWords 与各章节 recommendedWords 之和必须吻合且落在字数区间内、outline 至少 2 个章节、key 唯一、brief 各字段完整、不生成正文块。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidGeneratedOutline(): never {
  throw new Error("大纲生成结果不符合要求");
}

function validateGeneratedOutline(result: GeneratedOutline, input: GenerateOutlineInput) {
  const selectedRange = LENGTH_RANGES[input.lengthPreset];
  if (
    result.recommendedTotalWords < selectedRange.min ||
    result.recommendedTotalWords > selectedRange.max ||
    result.recommendedTotalWords < input.wordRange.min ||
    result.recommendedTotalWords > input.wordRange.max
  ) {
    invalidGeneratedOutline();
  }

  const keys = new Set(result.outline.map((section) => section.key));
  if (keys.size !== result.outline.length) invalidGeneratedOutline();

  if (!input.sourceContext?.trim() && result.brief.unsupportedNotes.length === 0) {
    invalidGeneratedOutline();
  }

  const sectionWords = result.outline.reduce(
    (total, section) => total + section.recommendedWords,
    0
  );
  if (Math.abs(sectionWords - result.recommendedTotalWords) > result.recommendedTotalWords * 0.15) {
    invalidGeneratedOutline();
  }

  return result;
}

export class OpenAiOutlineGenerator implements OutlineGenerator {
  constructor(private readonly client: JsonClient) {}

  async generate(input: GenerateOutlineInput): Promise<GeneratedOutline> {
    const result = await this.client.complete({
      model: input.model,
      // 只要带上了任一「修订意图」就走修订提示词：只有用户要求、没有审核意见时同样成立。
      systemPrompt: input.reviewFeedback || input.userInstructions
        ? OUTLINE_REVISION_SYSTEM_PROMPT
        : OUTLINE_GENERATOR_SYSTEM_PROMPT,
      userPayload: input,
      schema: generatedOutlineSchema,
      timeoutMs: 600_000
    });
    return validateGeneratedOutline(result, input);
  }
}
