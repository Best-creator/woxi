import type { ProviderConfig } from "@/server/config";
import { imagePlanResponseSchema } from "./schemas";
import type { ImagePlanSuggestion } from "./domain";
import type { VisualPlanInput, VisualPlanner } from "./visual-planner";

const VISUAL_PLANNER_BASE_PROMPT = `你是微信公众号文章的动漫分镜师。只返回 { "images": [...] } 形式的 JSON，不要 Markdown 或说明。

工作流程：
1. 通读正文，按顺序找出读者「需要图示才能秒懂」的位置：抽象概念、过程步骤、对比关系、关键数据、重要场景；
2. 每个需要解释的点设计一格动漫分镜（type="storyboard"），像一部科普短片的关键帧，连续起来能讲通正文脉络；
3. 另外输出 1 张封面（type="cover"，公众号头图），不占分镜序号。

字段要求（每一项都必须包含全部字段）：
- type："cover" 或 "storyboard"；
- anchorBlockId：cover 必须为 null；storyboard 必须使用用户提供的、该分镜所解释段落的非图片块 id；
- sceneNumber：分镜序号，从 1 开始连续递增（cover 无此字段）；
- shot：景别与镜头语言，从「大远景、远景、全景、中景、近景、特写、俯视、仰视、过肩视角」中选择；相邻分镜的景别必须有变化；
- purpose：一句话说明这格分镜解释正文的哪个点（20 字内）；
- prompt：中文动漫分镜画面描述，必须包含：角色正在做什么（动作与表情）、场景与关键道具、情绪氛围、镜头景别；末尾以「画面文字：XXX」给出画面中出现的简短中文文字（不超过 12 字，封面可选）；
- altText：中文替代文本，不超过 40 字；
- aspectRatio：cover 用 "cover"；分镜用 "landscape" 或 "portrait"。

画面构成：每格分镜默认为单画面；当分割画面能更清楚地解释时（连续动作、因果对比、时间推进），可以设计为格内多画面拼格（2-3 个小画面），并在 prompt 开头写明分割方式（如「上下两格」「左右两格」「三格横排蒙太奇」），再分别简述每个小画面的内容。单画面还是拼格由该格要解释的内容决定，不强制。

分镜连贯性要求：
- 全部分镜共用同一主角、同一画风，像同一部作品的连续画面；
- 每格只聚焦一个信息点，宁缺毋滥：分镜加上封面总数最多 11 项；
- 分镜要「解释」而不只是「配图」：画面要承担正文的说明职责（展示过程、呈现关系、具象化抽象概念）；
- 未指定绘制风格时，默认统一采用日系动漫画风：清晰线条、赛璐璐上色、明快配色、适当速度线与情绪符号。`;

/**
 * 组装规划系统提示词：绘制风格与参考形象为可选注入，
 * 画面文字要求恒定生效（AI 负责为每张图拟一处画面中的文字）。
 */
export function buildVisualPlannerSystemPrompt(
  options: { style?: string; character?: { name: string; persona: string; description: string } } = {}
) {
  const lines = [VISUAL_PLANNER_BASE_PROMPT];
  if (options.style?.trim()) {
    lines.push(
      `绘制风格：本次所有配图必须统一采用「${options.style.trim()}」风格，prompt 中要明确体现该风格的笔触、上色与画面质感。`
    );
  }
  const character = options.character;
  if (character?.name.trim()) {
    lines.push(
      `参考形象：每张配图都以同一主角「${character.name.trim()}」出镜。` +
        (character.persona.trim() ? `角色身份：${character.persona.trim()}。` : "") +
        (character.description.trim() ? `外形基准：${character.description.trim()}。` : "") +
        `每张图的 prompt 开头先用一两句复现该形象的关键外形特征（轮廓、配色、标志性元素），保证多张图之间形象一致；表情动作可随画面内容变化。`
    );
  }
  lines.push(
    "画面文字：除封面外，每格分镜的画面中要出现漫画式文字，由你按内容选择形式——角色说话用对白气泡、叙述解释用旁白框，文字不超过 20 字；并以「画面文字：对白气泡『XXX』」或「画面文字：旁白框『XXX』」的格式写在该格 prompt 的末尾；封面可选。"
  );
  return lines.join("\n");
}

export class VisualPlannerError extends Error {
  constructor(
    public readonly code: "timeout" | "authentication" | "invalid_response" | "upstream",
    message: string
  ) {
    super(message);
    this.name = "VisualPlannerError";
  }
}

function invalidResponse() {
  return new VisualPlannerError("invalid_response", "视觉规划服务返回了无效结果，请稍后重试。");
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export class OpenAiVisualPlanner implements VisualPlanner {
  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async plan(input: VisualPlanInput) {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: input.model?.trim() || this.config.model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: buildVisualPlannerSystemPrompt({ style: input.style, character: input.character })
            },
            {
              role: "user",
              content: JSON.stringify({
                title: input.title,
                topic: input.topic,
                ...(input.style?.trim() ? { style: input.style.trim() } : {}),
                ...(input.character ? { character: input.character } : {}),
                blocks: input.blocks
              })
            }
          ]
        }),
        // 慢速推理模型（高 reasoning tokens）规划一次可能超过一分钟，30s 会假超时。
        signal: AbortSignal.timeout(120_000)
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new VisualPlannerError("timeout", "视觉规划服务响应超时，请稍后重试。");
      }
      throw new VisualPlannerError("upstream", "视觉规划服务暂时不可用，请稍后重试。");
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new VisualPlannerError("authentication", "视觉规划服务认证失败，请检查服务配置。");
      }
      throw new VisualPlannerError("upstream", "视觉规划服务暂时不可用，请稍后重试。");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw invalidResponse();
    }

    const choices = (payload as { choices?: unknown })?.choices;
    const content = Array.isArray(choices)
      ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
      : undefined;
    if (typeof content !== "string") throw invalidResponse();

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      throw invalidResponse();
    }

    const plan = imagePlanResponseSchema.safeParse(parsedContent);
    if (!plan.success) throw invalidResponse();

    const anchorIds = new Set(
      input.blocks.filter((block) => block.type !== "image").map((block) => block.id)
    );
    if (
      plan.data.images.some(
        (suggestion) => suggestion.anchorBlockId !== null && !anchorIds.has(suggestion.anchorBlockId)
      )
    ) {
      throw invalidResponse();
    }

    return plan.data.images.map(normalizeSuggestion);
  }
}

interface RawStoryboardSuggestion {
  type: "storyboard";
  anchorBlockId: string;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImagePlanSuggestion["aspectRatio"];
  sceneNumber?: number;
  shot?: string;
}

/**
 * 分镜项归一化：把模型输出的 sceneNumber/shot 编进 purpose 与 prompt，
 * 剔除存储层未定义的字段——分镜序号与景别随用途走文本，数据库无需新列。
 */
function normalizeSuggestion(suggestion: ImagePlanSuggestion): ImagePlanSuggestion {
  if (suggestion.type !== "storyboard") return suggestion;
  const raw = suggestion as unknown as RawStoryboardSuggestion;
  const scene = typeof raw.sceneNumber === "number" ? raw.sceneNumber : null;
  const shot = raw.shot?.trim() || "中景";
  return {
    type: "storyboard",
    anchorBlockId: raw.anchorBlockId,
    purpose: `${scene ? `分镜 ${scene}｜` : ""}${shot}：${raw.purpose}`,
    prompt: `动漫分镜${scene ? ` 第 ${scene} 格` : ""}，${shot}镜头。${raw.prompt}`,
    altText: raw.altText,
    aspectRatio: raw.aspectRatio
  };
}
