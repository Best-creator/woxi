import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { DEFAULT_AUDIENCE_ID, describeAudience } from "./audience";
import { contentReviewResultSchema } from "./schemas";
import {
  charCount,
  inspectStoryComicDialogueBalance,
  inspectStoryComicSegment,
  inspectStoryComicTextOnlyBalance,
  STORY_COMIC_MAX_SEGMENT_CHARS,
  STORY_COMIC_MAX_SENTENCE_CHARS,
  STORY_COMIC_TOLERANCE
} from "./story-comic-rules";
import { describeStyleProfile } from "./style-profile";
import type {
  ContentReviewIssue,
  ContentReviewResult,
  ContentReviewer,
  ReviewableContentBlock,
  ReviewableStoryboardSegment,
  ReviewContentInput
} from "./ports";

export const CONTENT_REVIEWER_SYSTEM_PROMPT = `你是独立的正文审核员，不要延续或美化生成者的判断。只返回 JSON，不要 Markdown 或解释。
返回对象必须严格使用以下字段名：{"status":"passed|needs_revision|blocked","summary":"总体判断","clarity":1,"beginnerFriendliness":1,"coherence":1,"engagement":1,"hookStrength":1,"outlineCoverage":1,"sourceFidelity":null,"styleMatch":1,"issues":[{"blockIds":["输入中的块 id"],"severity":"warning|blocking","message":"问题"}]}。
八个维度分别检查：清晰度、零基础友好度、连贯性、吸引力、钩子强度、大纲覆盖、资料一致性、人物风格匹配，取值均为 1 到 5 的整数。
hookStrength 只看「前几句话有没有让人想读下去」：开场是不是具体画面或反常事实、有没有一句让人想继续滑的钩子；空泛的万金油提问（「你有没有想过」「你知道吗」——问题不具体、答案也不当场兑现）、先给结论再举例、开头就说「今天我们来聊聊」都要扣分并在 issues 里指出。
coherence（连贯性）判的是**跨段衔接**，逐段往下读：上一段结尾抛出的钩子（问题/悬念/反常的话），下一段开头有没有接住并作答；段与段是否共守同一条主线，还是各自为政的独立卡片；段首是否凭空重起开场。AI 味总结腔——「综上」「综上所述」「总而言之」「值得一提的是」「不容忽视」「首先…其次…最后」式分点——出现即扣分，并在 issues 里点名是哪一段的哪一句。整篇互相独立、钩子大量不接、或总结腔成片，coherence 给 2 或更低。
检查时要代入 targetAudience 描述的读者：他们的兴趣、痛点和禁忌就是判断标准，不要用泛泛的「普通人」标准打分。
styleMatch 还要检查标题与表达是否守规矩：悬念式标题、夸大或施压句式（如「90% 的人都不知道」「不看就晚了」）、促销引流措辞，一律扣分并在 issues 里指出。
presentation 为 story_comic（剧情漫画）时，文案按剧情漫画的红线判：每段文案不超过 ${STORY_COMIC_MAX_SEGMENT_CHARS} 字（段名是内部用的，不进正文也不占这 ${STORY_COMIC_MAX_SEGMENT_CHARS} 字）、每句话不超过 ${STORY_COMIC_MAX_SENTENCE_CHARS} 字，全篇总字数要落在 recommendedTotalWords 的七成到预算之间，明显不足和明显超出都要在 issues 里指出；出现「首先 / 其次 / 最后 / 因为…所以」这类解释连接词、超过 3 项的并列列举、教科书式推进，都要在 issues 里指出并扣 engagement 与 hookStrength 的分——读者要的是「有意思」，不是「讲得全」。冷开场设问（具体问题 + 当场抖出荒谬答案）、外号命名、段末设问钩子是剧情漫画的合法节拍，不要按提问式开场或过渡词扣分。你只管判文案：分镜提示词是否要求画面写字、台词是否超长、全篇对白帧够不够这类机械红线由服务端逐条核对，不必重复检查。
有资料时 sourceFidelity 为 1 到 5 的整数；没有资料时 sourceFidelity 必须为 null。
blocked 必须至少包含一个 severity 为 blocking 的 issue。
issues 的 blockIds 只能引用输入 blocks 中给出的 id，不能虚构块；无法定位到具体块时用空数组。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

/**
 * 剧情漫画形态的机械检查：红线口径集中在 story-comic-rules（设计提示词与这里同源），
 * 逐段核对每段文案字数、单句长度、词句风格、画面写字、台词长度，外加全篇字数预算上限。
 *
 * 全篇预算**只在这里判上限**：欠量（段数太少导致字数不够）不做机械判据——
 * 无 API Key 的 Demo 设计器固定「逐章一段」，机械判欠量会让本地与 E2E 的每一篇
 * 都变成「需要修订」。欠量交给设计提示词（段数按预算反推）与审核模型的判断题。
 *
 * 生成阶段不再用这些红线打回设计稿（作者要先有东西可看、可改、可退），
 * 「越界了」这件事由这里接管：全部报成定位到段的 warning，并把 status 拉下来，
 * 由作者决定改还是接受——限制的把关环节是审核，不是生成。
 *
 * 段落素材优先取 input.storyboardSegments（带帧提示词与台词，机械红线才判得全）；
 * 老快照没有它，退回「小标题块 + 其后文案块」的分段流水线（只能判文案那几条）。
 */
export function storyComicRedlineIssues(input: ReviewContentInput): ContentReviewIssue[] {
  const segments = input.storyboardSegments?.length
    ? input.storyboardSegments
    : segmentizeBlocks(input.blocks);
  const issues: ContentReviewIssue[] = [];
  for (const segment of segments) {
    for (const complaint of inspectStoryComicSegment({
      copy: segment.copy,
      // prompt 与台词按帧成对：对白帧查「台词是否写进 prompt」（气泡要画这句词），
      // 旁白帧与无台词帧查「画面里是否出现画字指令」。
      frames: segment.frames.map((frame) => ({
        prompt: frame.prompt,
        speechLine: frame.speechLine ?? null
      }))
    })) {
      issues.push({
        blockIds: segment.blockIds.slice(0, 1),
        severity: "warning",
        message: `剧情漫画红线：${segment.title ? `「${segment.title}」段` : "有一段"}${complaint}`
      });
    }
  }
  const budget = input.recommendedTotalWords ?? 0;
  if (budget > 0) {
    // 段名是内部段名、不进正文也不进图，所以全篇口径与每段一致：只数读者读到的 copy。
    const totalChars = segments.reduce((sum, segment) => sum + charCount(segment.copy), 0);
    if (totalChars > Math.round(budget * STORY_COMIC_TOLERANCE)) {
      issues.push({
        // 不定位到任何块：全篇问题，不该只算在某一段头上。
        blockIds: [],
        severity: "warning",
        message: `剧情漫画红线：全篇文案 ${totalChars} 字，超出目标 ${budget} 字的预算（全篇问题，压掉冗余再改）`
      });
    }
  }
  // 全篇对白密度 + 纯文字占比：只对带分镜的输入判——老快照的退化路径帧与路由信息全空，
  // 判不了也不该判（否则每一篇老文章都会凭空多出两条全篇警告）。两者都是全篇级配额，不定位到段。
  if (input.storyboardSegments?.length) {
    const dialogueFrameCount = input.storyboardSegments.reduce(
      (sum, segment) =>
        sum + segment.frames.filter((frame) => frame.speechLine?.kind === "dialogue").length,
      0
    );
    for (const complaint of inspectStoryComicDialogueBalance({
      segmentCount: input.storyboardSegments.length,
      dialogueFrameCount
    })) {
      issues.push({
        blockIds: [],
        severity: "warning",
        message: `剧情漫画红线：${complaint}（全篇问题，优先在重写或新增的段里补一来一往的对白）`
      });
    }
    // 纯文字段占比 ≥30%：老快照没有 route 字段，一律按非纯文字段数——
    // 缺 route 的输入判出来的只会是误报，所以只在 route 真实存在时才数。
    const routeKnown = input.storyboardSegments.filter(
      (segment) => segment.route !== undefined
    ).length;
    if (routeKnown === input.storyboardSegments.length) {
      const textOnlyCount = input.storyboardSegments.filter(
        (segment) => segment.route === "text_only"
      ).length;
      for (const complaint of inspectStoryComicTextOnlyBalance({
        segmentCount: input.storyboardSegments.length,
        textOnlyCount
      })) {
        issues.push({
          blockIds: [],
          severity: "warning",
          message: `剧情漫画红线：${complaint}（全篇问题，把不需要画面的段改成「纯文字」排法）`
        });
      }
    }
  }
  return issues;
}

/** 老快照的退化路径：按「小标题块起新段、其余块并入该段文案」切分，块 id 一并带走。 */
function segmentizeBlocks(blocks: ReviewableContentBlock[]): ReviewableStoryboardSegment[] {
  const segments: ReviewableStoryboardSegment[] = [];
  let current: ReviewableStoryboardSegment | null = null;
  for (const block of blocks) {
    if (block.type === "heading") {
      current = {
        blockIds: [block.id],
        title: block.content.trim(),
        copy: "",
        frames: []
      };
      segments.push(current);
      continue;
    }
    if (!current) continue;
    current.copy = current.copy ? `${current.copy}\n\n${block.content.trim()}` : block.content.trim();
    current.blockIds.push(block.id);
  }
  return segments;
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
  const mechanical =
    input.presentation === "story_comic" ? storyComicRedlineIssues(input) : [];
  const issues = [...mapped, ...mechanical];
  // 没资料却打了资料一致分 → 视为不适用；有资料却漏评 → 取中性分 3，
  // 不高估也不美化，只是不让整份审核因一个数字作废。
  const sourceFidelity = input.sourceContext?.trim() ? (result.sourceFidelity ?? 3) : null;
  // 状态只降不升，三条降级理由：
  // 1) blocked 必须有阻断级问题支撑；模型忘了给就降级，避免误锁死确认。
  // 2) 模型说 passed 但机械红线有越界 → 降级为需要修订。生成阶段已经不拦这些红线，
  //    审核是唯一的把关点；「通过」配上满屏 warning 会让作者以为可以放心提交。
  // 3) 连贯性烂到阈值（coherence ≤ 2）却报 passed → 降级为需要修订。2026-09-22
  //    用户拍板「不连贯要有牙齿」：跨段钩子不接、整篇卡片化是审核语义的判分题，
  //    模型打了低分就不允许状态层面「passed」自相矛盾；阈值取 2 是留出 3 分中性带，
  //    避免普通瑕疵的文章被推倒重写（生成阶段不打回的哲学不变，这里拦的是审核确认）。
  const blockedWithoutSupport =
    result.status === "blocked" && !issues.some((issue) => issue.severity === "blocking");
  const passedWithMechanicalIssues = result.status === "passed" && mechanical.length > 0;
  const passedButIncoherent =
    result.status === "passed" && typeof result.coherence === "number" && result.coherence <= 2;
  const status =
    blockedWithoutSupport || passedWithMechanicalIssues || passedButIncoherent
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
        // 字数预算：剧情漫画要它的总字数不要明显超预算（逐段红线的补充）。
        ...(input.recommendedTotalWords ? { recommendedTotalWords: input.recommendedTotalWords } : {}),
        ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
      },
      schema: contentReviewResultSchema,
      timeoutMs: 90_000
    });
    return sanitizeContentReview(result, input);
  }
}
