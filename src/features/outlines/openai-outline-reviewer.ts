import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { OutlineReviewResult, ReviewOutlineInput } from "./domain";
import type { OutlineReviewer } from "./ports";
import { outlineReviewResultSchema } from "./schemas";

export const OUTLINE_REVIEWER_SYSTEM_PROMPT = `你是独立的大纲审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","coverage":1,"granularity":1,"beginnerFriendliness":1,"logicalOrder":1,"sourceSupport":null,"hiddenPrerequisites":[],"complexDependencies":[],"issues":[{"sectionKey":"输入中的章节键","severity":"warning|blocking","message":"问题"}]}。
coverage、granularity、beginnerFriendliness、logicalOrder、sourceSupport（有资料时）均为1到5的整数。没有资料时 sourceSupport 必须为 null。blocked 必须至少包含一个 severity 为 blocking 的 issue。所有问题只能引用输入中给出的 sectionKey；不能虚构章节。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function invalidOutlineReview(): never {
  throw new Error("大纲审核结果不符合要求");
}

function sectionKeys(input: ReviewOutlineInput) {
  const keys = input.outline.map((section) => section.key ?? section.id);
  if (keys.some((key) => !key)) invalidOutlineReview();
  return new Set(keys);
}

function validateOutlineReview(result: OutlineReviewResult, input: ReviewOutlineInput) {
  const keys = sectionKeys(input);
  const orderedKeys = input.outline.map((section) => section.key ?? section.id).filter((key): key is string => Boolean(key));
  const normalized = {
    ...result,
    issues: result.issues.map((issue) => {
      const position = /^section-(\d+)$/.exec(issue.sectionKey)?.[1];
      const index = position ? Number(position) - 1 : -1;
      return index >= 0 && orderedKeys[index] ? { ...issue, sectionKey: orderedKeys[index] } : issue;
    })
  };
  if (normalized.issues.some((issue) => !keys.has(issue.sectionKey))) invalidOutlineReview();
  if (!input.sourceContext?.trim() && normalized.sourceSupport !== null) invalidOutlineReview();
  if (input.sourceContext?.trim() && normalized.sourceSupport === null) invalidOutlineReview();
  if (normalized.status === "blocked" && !normalized.issues.some((issue) => issue.severity === "blocking")) {
    invalidOutlineReview();
  }
  return normalized;
}

export class OpenAiOutlineReviewer implements OutlineReviewer {
  constructor(private readonly client: JsonClient) {}

  async review(input: ReviewOutlineInput): Promise<OutlineReviewResult> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: OUTLINE_REVIEWER_SYSTEM_PROMPT,
      userPayload: {
        ...input,
        outline: input.outline.map((section) => ({
          ...section,
          sectionKey: section.key ?? section.id
        }))
      },
      schema: outlineReviewResultSchema,
      // 审核是单次打分调用，实测 glm-5.3-flash ~10s、深度推理模型 ~100s；
      // 180s 已有充足裕量，超时后失败快速可见而不是干等 10 分钟。
      timeoutMs: 180_000
    });
    return validateOutlineReview(result, input);
  }
}
