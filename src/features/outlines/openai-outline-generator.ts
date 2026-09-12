import { LENGTH_RANGES } from "@/features/articles/domain";
import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { GeneratedOutline, GenerateOutlineInput } from "./domain";
import type { OutlineGenerator } from "./ports";
import { generatedOutlineSchema } from "./schemas";

export const OUTLINE_GENERATOR_SYSTEM_PROMPT = `你是面向普通读者的知识纲要生成器。只返回 JSON，不要 Markdown、解释或正文内容块。
返回对象必须严格使用以下字段名：
{"workingTitle":"文章标题","recommendedTotalWords":1200,"brief":{"oneSentence":"一句话核心解释","concepts":["概念"],"prerequisites":["前置知识"],"misconceptions":["常见误区"],"analogies":["类比"],"unsupportedNotes":["需要核验的事实"]},"outline":[{"key":"section_key","title":"章节标题","goal":"本节讲清什么","recommendedWords":300}]}
其中 outline 至少 2 个章节；key 只能包含小写字母、数字、下划线或连字符；recommendedTotalWords 和 recommendedWords 必须是整数。读者是零基础普通读者：先建立直觉，再引入术语；识别需要的前置知识和常见误区；为讲清楚概念推荐足够但不臃肿的字数。
没有资料时，必须在 brief.unsupportedNotes 中写明需要人工核验的事实。只生成 brief 与章节纲要，绝不生成文章正文块。`;

export const OUTLINE_REVISION_SYSTEM_PROMPT = `${OUTLINE_GENERATOR_SYSTEM_PROMPT}
如果输入包含 currentOutline、currentBrief 和 reviewFeedback，必须根据审核意见修订现有大纲，而不是从零另起一份无关结构。保留仍然有效的章节意图，逐条处理 issues、hiddenPrerequisites 和 complexDependencies；修订后的大纲应能直接回应这些审核意见。`;

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
      systemPrompt: input.reviewFeedback ? OUTLINE_REVISION_SYSTEM_PROMPT : OUTLINE_GENERATOR_SYSTEM_PROMPT,
      userPayload: input,
      schema: generatedOutlineSchema,
      timeoutMs: 600_000
    });
    return validateGeneratedOutline(result, input);
  }
}
