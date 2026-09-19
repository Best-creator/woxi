import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { DEFAULT_AUDIENCE_ID, describeAudience } from "./audience";
import { contentReviewResultSchema } from "./schemas";
import { inspectStoryComicSegment } from "./story-comic-rules";
import { describeStyleProfile } from "./style-profile";
import type {
  ContentReviewIssue,
  ContentReviewResult,
  ContentReviewer,
  ReviewContentInput
} from "./ports";

export const CONTENT_REVIEWER_SYSTEM_PROMPT = `你是独立的正文审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","clarity":1,"beginnerFriendliness":1,"coherence":1,"engagement":1,"hookStrength":1,"outlineCoverage":1,"sourceFidelity":null,"styleMatch":1,"issues":[{"blockIds":["输入中的块 id"],"severity":"warning|blocking","message":"问题"}]}。
八个维度分别检查：清晰度、零基础友好度、连贯性、吸引力、钩子强度、大纲覆盖、资料一致性、人物风格匹配，取值均为 1 到 5 的整数。
hookStrength 只看「前几句话有没有让人想读下去」：开场是不是具体画面或反常事实、有没有一句让人想继续滑的钩子；空泛的万金油提问（「你有没有想过」「你知道吗」——问题不具体、答案也不当场兑现）、先给结论再举例、开头就说「今天我们来聊聊」都要扣分并在 issues 里指出。
检查时要代入 targetAudience 描述的读者：他们的兴趣、痛点和禁忌就是判断标准，不要用泛泛的「普通人」标准打分。
styleMatch 还要检查标题与表达是否守规矩：悬念式标题、夸大或施压句式（如「90% 的人都不知道」「不看就晚了」）、促销引流措辞，一律扣分并在 issues 里指出。
presentation 为 story_comic（剧情漫画）时，文案按剧情漫画的红线判：每段（小标题 + 文案）不超过 60 字、每句话不超过 22 字；出现「首先 / 其次 / 最后 / 因为…所以」这类解释连接词、超过 3 项的并列列举、教科书式推进，都要在 issues 里指出并扣 engagement 与 hookStrength 的分——读者要的是「有意思」，不是「讲得全」。冷开场设问（具体问题 + 当场抖出荒谬答案）、外号命名、段末设问钩子是剧情漫画的合法节拍，不要按提问式开场或过渡词扣分。这里只审文案，分镜画面是否要求生图模型写字不在这份输入里。
有资料时 sourceFidelity 为 1 到 5 的整数；没有资料时 sourceFidelity 必须为 null。
blocked 必须至少包含一个 severity 为 blocking 的 issue。
issues 的 blockIds 只能引用输入 blocks 中给出的 id，不能虚构块；无法定位到具体块时用空数组。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

/**
 * 剧情漫画形态的机械检查：红线口径集中在 story-comic-rules（与生成闸门同源），
 * 这里按「小标题块 + 其后的文案块」分段逐条核对。
 * 只补 warning 级意见、不动 status：作者手改出来的长句也照样报出来，
 * 但改不改由作者决定；模型产物在生成阶段已经被闸门拦过一遍。
 */
export function storyComicRedlineIssues(input: ReviewContentInput): ContentReviewIssue[] {
  const issues: ContentReviewIssue[] = [];
  let anchorId: string | null = null;
  let title = "";
  let copy: string[] = [];
  const flush = () => {
    if (!anchorId && !copy.length) return;
    for (const complaint of inspectStoryComicSegment({ title, copy: copy.join("\n\n") })) {
      issues.push({
        blockIds: anchorId ? [anchorId] : [],
        severity: "warning",
        message: `剧情漫画红线：${title ? `「${title}」段` : "有一段"}${complaint}`
      });
    }
  };
  for (const block of input.blocks) {
    if (block.type === "heading") {
      flush();
      anchorId = block.id;
      title = block.content.trim();
      copy = [];
      continue;
    }
    copy.push(block.content.trim());
  }
  flush();
  return issues;
}

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
  const mapped = result.issues.map((issue) => ({
    ...issue,
    blockIds: issue.blockIds.filter((id) => blockIds.has(id))
  }));
  // 剧情漫画形态补一遍机械红线（服务端说了算，不依赖模型自觉）。
  const issues =
    input.presentation === "story_comic"
      ? [...mapped, ...storyComicRedlineIssues(input)]
      : mapped;
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
        // 形态决定红线口径（剧情漫画 / 讲解式）：不做形态判断的模型也知道自己在审什么。
        presentation: input.presentation ?? "illustrated",
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
