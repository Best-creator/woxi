import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { contentReviewResultSchema } from "./schemas";
import { describeStyleProfile } from "./style-profile";
import type { ContentReviewResult, ContentReviewer, ReviewContentInput } from "./ports";

export const CONTENT_REVIEWER_SYSTEM_PROMPT = `你是独立的正文审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","clarity":1,"beginnerFriendliness":1,"coherence":1,"engagement":1,"outlineCoverage":1,"sourceFidelity":null,"styleMatch":1,"issues":[{"blockIds":["输入中的块 id"],"severity":"warning|blocking","message":"问题"}]}。
七个维度分别检查：清晰度、零基础友好度、连贯性、吸引力、大纲覆盖、资料一致性、人物风格匹配，取值均为 1 到 5 的整数。
有资料时 sourceFidelity 为 1 到 5 的整数；没有资料时 sourceFidelity 必须为 null。
blocked 必须至少包含一个 severity 为 blocking 的 issue。
issues 的 blockIds 只能引用输入 blocks 中给出的 id，不能虚构块；无法定位到具体块时用空数组。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidContentReview(): never {
  throw new Error("正文审核结果不符合要求");
}

export function validateContentReview(
  result: ContentReviewResult,
  input: ReviewContentInput
): ContentReviewResult {
  const blockIds = new Set(input.blocks.map((block) => block.id));
  if (result.issues.some((issue) => issue.blockIds.some((id) => !blockIds.has(id)))) {
    invalidContentReview();
  }
  if (!input.sourceContext?.trim() && result.sourceFidelity !== null) invalidContentReview();
  if (input.sourceContext?.trim() && result.sourceFidelity === null) invalidContentReview();
  if (result.status === "blocked" && !result.issues.some((issue) => issue.severity === "blocking")) {
    invalidContentReview();
  }
  return result;
}

export class OpenAiContentReviewer implements ContentReviewer {
  constructor(private readonly client: JsonClient) {}

  async review(input: ReviewContentInput): Promise<ContentReviewResult> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: CONTENT_REVIEWER_SYSTEM_PROMPT,
      userPayload: {
        topic: input.topic,
        targetAudience: input.targetAudience ?? "对该知识点零基础的普通读者",
        styleProfile: describeStyleProfile(input.styleProfile),
        blocks: input.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          content: block.content,
          order: block.order
        })),
        outline: input.outline.map((section) => ({
          sectionId: section.id,
          title: section.title,
          goal: section.goal ?? section.title
        })),
        ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
      },
      schema: contentReviewResultSchema,
      timeoutMs: 90_000
    });
    return validateContentReview(result, input);
  }
}
