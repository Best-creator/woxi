import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { generatedContentSchema } from "./schemas";
import { describeStyleProfile } from "./style-profile";
import type { ContentGenerator, GenerateContentInput, GeneratedContent } from "./ports";

export const CONTENT_GENERATOR_SYSTEM_PROMPT = `你是公众号知识类图文的正文作者。只返回 JSON，不要 Markdown 代码块或解释。
返回对象必须严格使用以下字段名：{"title":"最终标题","blocks":[{"sectionKey":"输入中的章节 id","type":"heading|paragraph|quote|callout|knowledge_card","content":"正文内容","level":2}]}。
硬性要求：
1. 必须按输入 outline 给出的顺序，一次写完整篇文章；每个章节至少产出一个正文块，并按需用一个 heading 块写出章节标题。
2. sectionKey 只能取输入 outline 中已存在的 id，禁止虚构或改写章节键。
3. 面向 targetAudience 描述的读者：先用具体场景建立直觉，再解释术语，最后给出概念名称。
4. 章节之间要有自然承接，不要写成互相独立的片段；禁止通过重复、空泛总结或无关案例凑字数。
5. 人物语言风格只改变措辞、句式、节奏、称呼和开场，不得改变事实、知识边界、章节顺序和必须解释的关键概念。
6. 不允许输出图片块；配图由独立流程负责。
7. 允许的块类型只有 heading、paragraph、quote、callout、knowledge_card。
8. 标题必须给出具体的信息或结论，读标题就知道这篇讲什么。禁止悬念式标题、禁止「90% 的人都不知道」「不看就晚了」这类夸大或施压句式、禁止促销引流措辞。
9. 字数是硬约束：全篇正文（含标题块、不含 JSON 结构）总字数不得超过 recommendedTotalWords，宁可略短也不要超长；每个章节以 outline 给出的 recommendedWords 为篇幅基准，上下浮动不超过 15%。写完在脑内数一遍字数再输出——超出上限与遗漏章节同为不合格。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidGeneratedContent(message: string): never {
  throw new Error(message);
}

/** 服务端字数容差：模型偶发小幅超标可接受，大幅超长直接打回重试。 */
const TOTAL_WORDS_TOLERANCE = 1.15;

export function validateGeneratedContent(
  result: GeneratedContent,
  input: GenerateContentInput
): GeneratedContent {
  const sectionKeys = new Set(input.outline.map((section) => section.id));
  if (!input.outline.length) invalidGeneratedContent("缺少已确认的大纲章节");
  for (const block of result.blocks) {
    if (!sectionKeys.has(block.sectionKey)) {
      invalidGeneratedContent("正文生成结果引用了未知章节");
    }
  }
  // 字数硬约束的第二道闸：提示词要求模型自控，这里兜底防大幅超长。
  const totalChars = result.blocks
    .map((block) => block.content)
    .join("")
    .replace(/\s/g, "").length;
  if (input.recommendedTotalWords > 0 && totalChars > Math.round(input.recommendedTotalWords * TOTAL_WORDS_TOLERANCE)) {
    invalidGeneratedContent(
      `正文总字数 ${totalChars} 超出目标 ${input.recommendedTotalWords} 字太多，请重试生成更精炼的版本`
    );
  }
  return result;
}

export class OpenAiContentGenerator implements ContentGenerator {
  constructor(private readonly client: JsonClient) {}

  async generate(input: GenerateContentInput): Promise<GeneratedContent> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: CONTENT_GENERATOR_SYSTEM_PROMPT,
      userPayload: {
        topic: input.topic,
        targetAudience: input.targetAudience,
        brief: input.brief,
        outline: input.outline,
        recommendedTotalWords: input.recommendedTotalWords,
        styleProfile: describeStyleProfile(input.styleProfile),
        ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
      },
      schema: generatedContentSchema,
      // 深度推理模型写整篇正文实测可达 2 分钟以上（验收实测 115s），
      // 给足余量避免贴线超时导致用户重试。
      timeoutMs: 300_000
    });
    return validateGeneratedContent(result, input);
  }
}
