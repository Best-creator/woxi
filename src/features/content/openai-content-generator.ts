import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { generatedContentSchema } from "./schemas";
import { describeComicCaptionBudget } from "./comic-script";
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
9. 若输入给出了 panelLimit，则全篇按不超过 panelLimit 个分镜组织，并且每个分镜固定只有两块：一个 heading 块作分镜标题（不超过 12 字，写成有信息量的一句话），紧接一个 paragraph 块作这一格的文案。画面由配图承担，文案只负责把这一格的结论钉住——${describeComicCaptionBudget()}，宁可少写，绝不允许为了显得充实而铺陈。全篇最多在最后一个分镜再追加一个 knowledge_card 块作为可立刻执行的行动清单。未给出 panelLimit 时忽略本条。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidGeneratedContent(message: string): never {
  throw new Error(message);
}

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
        ...(input.panelLimit ? { panelLimit: input.panelLimit } : {}),
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
