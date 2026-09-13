import type { ProviderConfig } from "@/server/config";
import { imagePlanResponseSchema } from "./schemas";
import type { VisualPlanInput, VisualPlanner } from "./visual-planner";

const VISUAL_PLANNER_BASE_PROMPT = `你是微信公众号文章的视觉规划助手。只返回 { "images": [...] } 形式的 JSON，不要 Markdown 或说明。
images 中每一项必须包含以下全部字段：
- type：cover、concept、process、comparison、knowledge_card 之一；
- anchorBlockId：cover 必须为 null，其他类型必须使用用户提供的非图片块的 id；
- purpose：一句话中文说明这张图解决什么问题；
- prompt：给图片生成模型的中文提示词，具体描述画面内容与风格；
- altText：图片的中文替代文本，不超过 40 字；
- aspectRatio：cover、landscape、square、portrait 之一（封面用 cover）。
最多返回 12 项，控制装饰图数量，避免为连续段落配图。`;

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
    "画面文字：除封面外，每张配图的画面中要出现一处简短中文文字（标题、关键词或标签，不超过 12 字），由你根据该图讲解的内容拟定，并以「画面文字：XXX」的格式写在该图 prompt 的末尾；封面可选。"
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

    return plan.data.images;
  }
}
