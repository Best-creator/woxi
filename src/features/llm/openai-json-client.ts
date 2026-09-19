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

function invalidResponse(detail = "") {
  return new LlmError(
    "invalid_response",
    `语言模型服务返回了无效结果${detail ? `（${detail}）` : ""}，请稍后重试。`
  );
}

/**
 * 剥掉模型偶发包裹的 Markdown 代码围栏（```json … ```）再解析。
 * json_object 模式下不该发生，但网关兼容性参差——兜底这一下能省掉一整轮重试。
 */
export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? (fenced[1] ?? trimmed) : trimmed).trim();
}

/** 重试时附在对话末尾的纠错指令（角色用 user，兼容性比第二条 system 消息好）。 */
const RETRY_NOTE =
  "上一次回复没有通过校验。请重新生成一次，只输出一个合法的 JSON 对象——不要 Markdown 代码块、注释或任何解释文字。";

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

    // 结构/格式失败（body 非 JSON、文本非 JSON、schema 不符）原地重试一次：
    // 这是「这一次的产出废了」而不是持续故障，附纠错指令让第二次直接改对——
    // 省掉用户手动点重试的一整个来回（分镜设计一次要几分钟）。
    // HTTP 状态错与超时不重试：那两类重试大概率还是坏，交给上层常规重试路径。
    let correctiveNote: string | null = null;
    let detail = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: JSON.stringify(request.userPayload) }
      ];
      if (correctiveNote) messages.push({ role: "user", content: correctiveNote });

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
            messages
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
        correctiveNote = RETRY_NOTE;
        continue;
      }

      const choices = (payload as { choices?: unknown })?.choices;
      const content = Array.isArray(choices)
        ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
        : undefined;
      if (typeof content !== "string") {
        correctiveNote = RETRY_NOTE;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFences(content));
      } catch {
        detail = "文本不是合法 JSON";
        correctiveNote =
          "上一次的文本不是合法 JSON——可能带了 Markdown 代码围栏或前后多余文字。" + RETRY_NOTE;
        continue;
      }

      const result = request.schema.safeParse(parsed);
      if (!result.success) {
        const issue = result.error.issues[0];
        detail = issue
          ? `${issue.path.length ? issue.path.map(String).join(".") : "根字段"}：${issue.message}`.slice(
              0,
              160
            )
          : "";
        correctiveNote = `上一次的 JSON 结构有问题，出在「${detail}」这个字段上。${RETRY_NOTE}`;
        continue;
      }
      return result.data;
    }

    throw invalidResponse(detail);
  }
}
