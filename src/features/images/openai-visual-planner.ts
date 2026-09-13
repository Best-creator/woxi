import type { ProviderConfig } from "@/server/config";
import { imagePlanResponseSchema } from "./schemas";
import type { VisualPlanInput, VisualPlanner } from "./visual-planner";

export const VISUAL_PLANNER_SYSTEM_PROMPT = `你是微信公众号文章的视觉规划助手。只返回 { "images": [...] } 形式的 JSON，不要 Markdown 或说明。
images 中每一项必须包含以下全部字段：
- type：cover、concept、process、comparison、knowledge_card 之一；
- anchorBlockId：cover 必须为 null，其他类型必须使用用户提供的非图片块的 id；
- purpose：一句话中文说明这张图解决什么问题；
- prompt：给图片生成模型的中文提示词，具体描述画面内容与风格；
- altText：图片的中文替代文本，不超过 40 字；
- aspectRatio：cover、landscape、square、portrait 之一（封面用 cover）。
最多返回 12 项，控制装饰图数量，避免为连续段落配图。`;

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
          model: this.config.model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: VISUAL_PLANNER_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(input) }
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
