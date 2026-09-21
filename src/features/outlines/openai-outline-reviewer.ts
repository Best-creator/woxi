import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import type { OutlineReviewResult, ReviewOutlineInput } from "./domain";
import type { OutlineReviewer } from "./ports";
import { outlineReviewResultSchema } from "./schemas";

export const OUTLINE_REVIEWER_SYSTEM_PROMPT = `你是独立的大纲审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","coverage":1,"granularity":1,"beginnerFriendliness":1,"logicalOrder":1,"sourceSupport":null,"hiddenPrerequisites":[],"complexDependencies":[],"issues":[{"sectionKey":"输入中的章节键","severity":"warning|blocking","message":"问题"}]}。
coverage、granularity、beginnerFriendliness、logicalOrder、sourceSupport（有资料时）均为1到5的整数。没有资料时 sourceSupport 必须为 null。blocked 必须至少包含一个 severity 为 blocking 的 issue。所有问题只能引用输入中给出的 sectionKey；不能虚构章节。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

function sectionKeys(input: ReviewOutlineInput) {
  return new Set(
    input.outline.map((section) => section.key ?? section.id).filter((key): key is string => Boolean(key))
  );
}

/** 把模型可能给的位置编号（section-2）映射回真实章节键；映射不了原样返回。 */
function resolveSectionKey(sectionKey: string, input: ReviewOutlineInput): string {
  const position = /^section-(\d+)$/.exec(sectionKey)?.[1];
  const index = position ? Number(position) - 1 : -1;
  const orderedKeys = input.outline.map((section) => section.key ?? section.id).filter((key): key is string => Boolean(key));
  return index >= 0 && orderedKeys[index] ? orderedKeys[index]! : sectionKey;
}

/**
 * 语义校验：返回给模型的纠错说明，合规时返回 null。
 *
 * 通过 client 的 validate 钩子接入纠错重试——语义错误（引用不存在的章节、
 * 资料口径自相矛盾、blocked 却没有 blocking 级问题）与 JSON 结构错误同款待遇：
 * 附上具体问题重试一次，而不是直接把 502 甩给作者。
 */
function semanticComplaint(result: OutlineReviewResult, input: ReviewOutlineInput): string | null {
  const keys = sectionKeys(input);
  if (result.issues.some((issue) => !keys.has(resolveSectionKey(issue.sectionKey, input)))) {
    return "issues 里的 sectionKey 不在输入给出的章节键集合中";
  }
  const hasSource = Boolean(input.sourceContext?.trim());
  if (!hasSource && result.sourceSupport !== null) return "没有资料时 sourceSupport 必须为 null";
  if (hasSource && result.sourceSupport === null) return "有资料时 sourceSupport 必须是 1-5 的整数";
  if (result.status === "blocked" && !result.issues.some((issue) => issue.severity === "blocking")) {
    return "status 为 blocked 时至少要有一个 severity 为 blocking 的 issue";
  }
  return null;
}

/** 纯转换：把位置编号（section-2）换成真实章节键；语义校验已在 client 层通过。 */
function normalizeOutlineReview(result: OutlineReviewResult, input: ReviewOutlineInput): OutlineReviewResult {
  return {
    ...result,
    issues: result.issues.map((issue) => ({
      ...issue,
      sectionKey: resolveSectionKey(issue.sectionKey, input)
    }))
  };
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
      validate: (candidate) => semanticComplaint(candidate, input),
      // 审核是单次打分调用，实测 glm-5.3-flash ~10s、深度推理模型 ~100s；
      // 180s 已有充足裕量，超时后失败快速可见而不是干等 10 分钟。
      timeoutMs: 180_000
    });
    return normalizeOutlineReview(result, input);
  }
}
