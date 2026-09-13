import type { ProviderConfig } from "@/server/config";
import {
  CharacterDescribeError,
  type CharacterDescribeInput,
  type CharacterDescriber
} from "./character-describer";

export const CHARACTER_DESCRIBER_SYSTEM_PROMPT = `你是角色形象提取助手。观察用户提供的参考图片，输出一段简体中文的角色外形描述（60~150 字），用于在绘图提示词中稳定复现这个形象。
只描述外观：造型轮廓、配色、比例、表情气质、标志性服饰或道具。
不要输出任何解释、前缀或引号。`;

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export class OpenAiCharacterDescriber implements CharacterDescriber {
  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async describe(input: CharacterDescribeInput) {
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
          messages: [
            { role: "system", content: CHARACTER_DESCRIBER_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "请提取这张参考图中的角色形象描述。" },
                { type: "image_url", image_url: { url: input.imageDataUrl } }
              ]
            }
          ]
        }),
        signal: AbortSignal.timeout(120_000)
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new CharacterDescribeError("timeout", "形象提取响应超时，请稍后重试。");
      }
      throw new CharacterDescribeError("upstream", "形象提取服务暂时不可用，请稍后重试。");
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new CharacterDescribeError("authentication", "形象提取服务认证失败，请检查服务配置。");
      }
      throw new CharacterDescribeError("upstream", "形象提取服务暂时不可用，请稍后重试。");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CharacterDescribeError("invalid_response", "形象提取返回了无效结果，请稍后重试。");
    }

    const choices = (payload as { choices?: unknown })?.choices;
    const content = Array.isArray(choices)
      ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
      : undefined;
    if (typeof content !== "string" || !content.trim()) {
      throw new CharacterDescribeError("invalid_response", "形象提取返回了无效结果，请稍后重试。");
    }
    return content.trim();
  }
}
