import type { LlmProviderConfig } from "@/server/config";
import { z } from "zod";
import { LlmError } from "./errors";

export interface JsonCompletionRequest<T> {
  model?: string;
  systemPrompt: string;
  userPayload: unknown;
  schema: z.ZodType<T>;
  timeoutMs: number;
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function invalidResponse() {
  return new LlmError("invalid_response", "语言模型服务返回了无效结果，请稍后重试。");
}

async function discoverRequestedModel(
  config: LlmProviderConfig,
  model: string,
  fetchFn: typeof fetch
) {
  let response: Response;
  try {
    response = await fetchFn(`${config.baseUrl.replace(/\/$/, "")}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    if (isTimeout(error)) throw new LlmError("timeout", "模型列表请求超时，请稍后重试。");
    throw new LlmError("upstream", "模型列表暂时不可用，请稍后重试。");
  }

  if (response.status === 401 || response.status === 403) {
    throw new LlmError("authentication", "语言模型服务认证失败，请检查服务配置。");
  }
  if (!response.ok) throw new LlmError("upstream", "模型列表暂时不可用，请稍后重试。");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalidResponse();
  }
  const models = (payload as { data?: Array<{ id?: unknown }> })?.data;
  if (!Array.isArray(models)) throw invalidResponse();
  return models.some((item) => item && typeof item.id === "string" && item.id.trim() === model);
}

export class OpenAiJsonClient {
  constructor(
    private readonly config: LlmProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async complete<T>(request: JsonCompletionRequest<T>): Promise<T> {
    const model = request.model ?? this.config.model;
    if (!this.config.availableModels.includes(model)) {
      const isAvailable = await discoverRequestedModel(this.config, model, this.fetchFn);
      if (!isAvailable) throw new LlmError("model_not_allowed", "请求的模型不在允许列表中。");
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) }
          ]
        }),
        signal: AbortSignal.timeout(request.timeoutMs)
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new LlmError("timeout", "语言模型服务响应超时，请稍后重试。");
      }
      throw new LlmError("upstream", "语言模型服务暂时不可用，请稍后重试。");
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new LlmError("authentication", "语言模型服务认证失败，请检查服务配置。");
      }
      throw new LlmError("upstream", "语言模型服务暂时不可用，请稍后重试。");
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw invalidResponse();
    }

    const result = request.schema.safeParse(parsed);
    if (!result.success) throw invalidResponse();
    return result.data;
  }
}
