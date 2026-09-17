import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { storyboardFrameCount } from "@/features/articles/domain";
import { storyboardDesignSchema } from "./schemas";
import { describeStyleProfile } from "./style-profile";
import type {
  GenerateContentInput,
  StoryboardDesign,
  StoryboardDesigner
} from "./ports";

export const STORYBOARD_DESIGNER_SYSTEM_PROMPT = `你是公众号知识类漫画的「正文分镜设计师」，同时完成两件事：把大纲写成逐段成稿文案；为每段文案设计 1-2 格动漫分镜。只返回 JSON，不要 Markdown 代码块或解释。
返回对象必须严格使用以下字段名：{"title":"最终标题","segments":[{"sectionKey":"输入中的章节 id","title":"段落小标题","route":"image_text|text_image|image_text_image","copy":"该段成稿文案","frames":[{"prompt":"完整生图提示词","altText":"中文替代文本"}]}]}。

呈现路由与帧数（硬性对应，帧数错了就是不合格）：
- image_text（图 + 文）：1 帧，画面在上、文案在下。适合文案偏长、信息密度高、需要先看懂图再细读文字的段落；
- text_image（文 + 图）：1 帧，文案在上、画面在下。适合先铺垫说明、再揭示画面的段落；
- image_text_image（图 + 文 + 图）：2 帧，文案落在两帧正中间，最像连环画。适合文案短（70 字内）、两帧能讲连续动作的段落。
你通读全文后为每一段独立选择最合适的 route，不要全篇同一 routing。

写作要求：
1. 按输入 outline 给出的顺序分段；sectionKey 只能取输入 outline 中已存在的 id，禁止虚构或改写；每个章节至少被一个段落覆盖。
2. 面向 targetAudience 描述的读者：先用具体场景建立直觉，再解释术语，最后给出概念名称。
3. 段与段之间要有自然承接，不要写成互相独立的片段；禁止通过重复、空泛总结或无关案例凑字数。
4. 人物语言风格只改变措辞、句式、节奏、称呼和开场，不得改变事实、知识边界、章节顺序和必须解释的关键概念。
5. 标题必须给出具体的信息或结论，读标题就知道这篇讲什么。禁止悬念式标题、禁止「90% 的人都不知道」「不看就晚了」这类夸大或施压句式、禁止促销引流措辞。
6. 字数是硬约束：全部分段的 title 与 copy 总字数不得超过 recommendedTotalWords，宁可略短也不要超长。写完在脑内数一遍字数再输出——超出上限与遗漏章节同为不合格。
7. 末段必须自然收尾：要点总结、行动清单或「记住这几件事」直接写进最后一段的文案里；不要在正文之外输出独立的知识卡片或总结模块——整篇就是 segments，没有其他部分。

分镜设计要求（每格画面的每个要素回答的都是「读者感受到什么」，而不是「画面里有什么」）：
- 叙事-视觉翻译：角色动作 = 内心状态的外化，写「做什么」同时暗示「为什么」；情绪精确到层次，不写「难过」要写「强撑体面但眼神已经垮下来」；镜头景别 = 心理距离，相邻帧的景别必须有变化；环境与道具 = 无声的情绪背景，为解释服务的道具要出现在画面里。
- prompt 必须是一份可以直接交给生图模型的完整提示词，包含：角色正在做什么（动作与表情）、场景与关键道具、情绪氛围（精确到层次）、镜头景别（从「大远景、远景、全景、中景、近景、特写、俯视、仰视、过肩视角」中选择）；末尾以「画面文字：对白气泡『XXX』」或「画面文字：旁白框『XXX』」给出画面中出现的漫画式文字（不超过 20 字）。
- image_text_image 的两帧必须讲同一场景里的连续动作（同一地点的下一秒），不要拼两张无关画面。
- 连贯性：全部分镜共用同一主角、同一画风，像同一部作品的连续画面；相邻段落共享场景基调（地点、时间、光线逻辑），不要无来由切换环境；道具与设定一旦出现，后面的帧继续出现时保持一致。
- 画面底色一律纯白（#FFFFFF）：不铺纸纹、不加渐变、不拍环境实景；若绘制风格里写到了背景，一律以纯白覆盖。理由：段图之后要竖向拼成一张长图，只有底色统一成白，一段一段才能连成一张纸。
- 未指定绘制风格时，默认统一采用日系动漫画风：清晰线条、赛璐璐上色、明快配色、适当速度线与情绪符号。
- altText 不超过 40 字。`;

type JsonClient = Pick<OpenAiJsonClient, "complete">;

/** 服务端字数容差：模型偶发小幅超标可接受，大幅超长直接打回。 */
const TOTAL_WORDS_TOLERANCE = 1.15;

/**
 * 设计稿的第二道闸：章节覆盖、路由-帧数对应、字数硬约束。
 * 提示词要求模型自控，这里兜底防结构性错误。
 */
export function validateStoryboardDesign(
  result: StoryboardDesign,
  input: GenerateContentInput
): StoryboardDesign {
  if (!input.outline.length) throw new Error("缺少已确认的大纲章节");
  const sectionKeys = new Set(input.outline.map((section) => section.id));
  const covered = new Set<string>();
  for (const segment of result.segments) {
    if (!sectionKeys.has(segment.sectionKey)) {
      throw new Error("分镜设计引用了未知章节");
    }
    covered.add(segment.sectionKey);
    if (segment.frames.length !== storyboardFrameCount(segment.route)) {
      throw new Error(
        `段落「${segment.title}」的呈现路由是 ${segment.route}，需要 ${storyboardFrameCount(segment.route)} 帧分镜，实际给了 ${segment.frames.length} 帧`
      );
    }
  }
  for (const section of input.outline) {
    if (!covered.has(section.id)) {
      throw new Error(`分镜设计遗漏了章节「${section.title}」`);
    }
  }
  const totalChars = result.segments
    .map((segment) => segment.title + segment.copy)
    .join("")
    .replace(/\s/g, "").length;
  if (
    input.recommendedTotalWords > 0 &&
    totalChars > Math.round(input.recommendedTotalWords * TOTAL_WORDS_TOLERANCE)
  ) {
    throw new Error(
      `文案总字数 ${totalChars} 超出目标 ${input.recommendedTotalWords} 字太多，请重试生成更精炼的版本`
    );
  }
  return result;
}

export class OpenAiStoryboardDesigner implements StoryboardDesigner {
  constructor(private readonly client: JsonClient) {}

  async design(input: GenerateContentInput): Promise<StoryboardDesign> {
    const result = await this.client.complete({
      model: input.model,
      systemPrompt: STORYBOARD_DESIGNER_SYSTEM_PROMPT,
      userPayload: {
        topic: input.topic,
        targetAudience: input.targetAudience,
        brief: input.brief,
        outline: input.outline,
        recommendedTotalWords: input.recommendedTotalWords,
        styleProfile: describeStyleProfile(input.styleProfile),
        ...(input.drawingStyle?.trim() ? { drawingStyle: input.drawingStyle.trim() } : {}),
        ...(input.character ? { character: input.character } : {}),
        ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
      },
      schema: storyboardDesignSchema,
      // 一次要写全文案 + 逐帧分镜，深度推理模型实测可达 2 分钟以上，给足余量。
      timeoutMs: 300_000
    });
    return validateStoryboardDesign(result, input);
  }
}
