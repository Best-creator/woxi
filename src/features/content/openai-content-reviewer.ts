import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { DEFAULT_AUDIENCE_ID, describeAudience } from "./audience";
import { contentReviewResultSchema } from "./schemas";
import { describeStyleProfile } from "./style-profile";
import type { ContentReviewResult, ContentReviewer, ReviewContentInput } from "./ports";

export const CONTENT_REVIEWER_SYSTEM_PROMPT = `你是独立的正文审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","clarity":1,"beginnerFriendliness":1,"coherence":1,"engagement":1,"outlineCoverage":1,"sourceFidelity":null,"styleMatch":1,"issues":[{"blockIds":["输入中的块 id"],"severity":"warning|blocking","message":"问题"}]}。
七个维度分别检查：清晰度、零基础友好度、连贯性、吸引力、大纲覆盖、资料一致性、人物风格匹配，取值均为 1 到 5 的整数。
检查时要代入 targetAudience 描述的读者：他们的兴趣、痛点和禁忌就是判断标准，不要用泛泛的「普通人」标准打分。
styleMatch 还要检查标题与表达是否守规矩：悬念式标题、夸大或施压句式（如「90% 的人都不知道」「不看就晚了」）、促销引流措辞，一律扣分并在 issues 里指出。
有资料时 sourceFidelity 为 1 到 5 的整数；没有资料时 sourceFidelity 必须为 null。
blocked 必须至少包含一个 severity 为 blocking 的 issue。
issues 的 blockIds 只能引用输入 blocks 中给出的 id，不能虚构块；无法定位到具体块时用空数组。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

/**
 * 审核结果的净化闸：模型偶发的小违规**就地修正而不是整份作废**。
 * 此前这里是硬校验（虚构块 id / 资料分缺失 / blocked 无阻断项都会抛
 * 「正文审核结果不符合要求」），一次小 slip 就让整个审核-修订循环卡死——
 * 用户只能放弃审核直接确认，意见驱动修订的链路随之断掉。
 */
export function sanitizeContentReview(
  result: ContentReviewResult,
  input: ReviewContentInput
): ContentReviewResult {
  const blockIds = new Set(input.blocks.map((block) => block.id));
  // 虚构的块 id 只丢弃 id、保住意见本身（空 blockIds 的意见界面本就支持：不可定位）。
  const issues = result.issues.map((issue) => ({
    ...issue,
    blockIds: issue.blockIds.filter((id) => blockIds.has(id))
  }));
  // 没资料却打了资料一致分 → 视为不适用；有资料却漏评 → 取中性分 3，
  // 不高估也不美化，只是不让整份审核因一个数字作废。
  const sourceFidelity = input.sourceContext?.trim() ? (result.sourceFidelity ?? 3) : null;
  // blocked 必须有阻断级问题支撑；模型忘了给就降级为需要修订，避免误锁死确认。
  const status =
    result.status === "blocked" && !issues.some((issue) => issue.severity === "blocking")
      ? "needs_revision"
      : result.status;
  return { ...result, issues, sourceFidelity, status };
}

export class OpenAiContentReviewer implements ContentReviewer {
  constructor(private readonly client: JsonClient) {}

  async review(input: ReviewContentInput): Promise<ContentReviewResult> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: CONTENT_REVIEWER_SYSTEM_PROMPT,
      userPayload: {
        topic: input.topic,
        targetAudience: input.targetAudience ?? describeAudience(DEFAULT_AUDIENCE_ID),
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
    return sanitizeContentReview(result, input);
  }
}
