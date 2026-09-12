import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type {
  ContentGenerator,
  GeneratedArticleContent,
  GenerateArticleContentInput
} from "./content-generator";
import { generatedArticleContentSchema } from "./schemas";

export const CONTENT_GENERATOR_SYSTEM_PROMPT = `你是面向普通读者的正文生成器。只返回 JSON，不要 Markdown、解释或图片。
你收到的是已确认的大纲。只能为 confirmedOutline 中已有的章节生成 heading、paragraph 和 callout 正文块；不得发明新章节、不得生成 image 或其他类型的块。heading 的内容只能是文章标题或 confirmedOutline 中已有的章节标题。如果输出文章标题 heading，它必须是第一个 block，且 level 为 1。
返回对象必须严格使用以下字段名：{"title":"文章标题","blocks":[{"id":"block-id","type":"heading|paragraph|callout","content":"内容","order":0,"version":1,"level":1}]}。
blocks 必须按从 0 开始、连续递增的 order 排列；version 必须为 1。先使用 Knowledge Brief 建立零基础读者需要的直觉，再依据已确认大纲依次展开。`; 

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidGeneratedArticleContent(): never {
  throw new Error("正文生成结果不符合要求");
}

function validateGeneratedArticleContent(
  value: unknown,
  input: GenerateArticleContentInput
): GeneratedArticleContent {
  const parsed = generatedArticleContentSchema.safeParse(value);
  if (!parsed.success) invalidGeneratedArticleContent();

  const permittedHeadings = new Set([parsed.data.title, ...input.outline.map((section) => section.title)]);
  if (parsed.data.blocks.some((block, index) => block.order !== index)) {
    invalidGeneratedArticleContent();
  }
  if (parsed.data.blocks.some((block) => block.type === "heading" && !permittedHeadings.has(block.content))) {
    invalidGeneratedArticleContent();
  }
  const firstBlock = parsed.data.blocks[0];
  const hasArticleTitleHeading = firstBlock?.type === "heading" &&
    firstBlock.content === parsed.data.title &&
    firstBlock.level === 1;
  const sectionHeadings = parsed.data.blocks
    .filter((block, index) =>
      block.type === "heading" &&
      !(hasArticleTitleHeading && index === 0) &&
      input.outline.some((section) => section.title === block.content)
    )
    .map((block) => block.content);
  if (
    sectionHeadings.length !== input.outline.length ||
    sectionHeadings.some((heading, index) => heading !== input.outline[index]?.title)
  ) {
    invalidGeneratedArticleContent();
  }
  return parsed.data;
}

export class OpenAiContentGenerator implements ContentGenerator {
  constructor(private readonly client: JsonClient) {}

  async generate(input: GenerateArticleContentInput): Promise<GeneratedArticleContent> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: CONTENT_GENERATOR_SYSTEM_PROMPT,
      userPayload: {
        topic: input.topic,
        brief: input.brief,
        confirmedOutline: input.outline,
        lengthPreset: input.lengthPreset,
        ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
      },
      schema: generatedArticleContentSchema,
      timeoutMs: 600_000
    });
    return validateGeneratedArticleContent(result, input);
  }
}
