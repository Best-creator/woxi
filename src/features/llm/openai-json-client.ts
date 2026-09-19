import type { LlmProviderConfig } from "@/server/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * 从一段散文里抠出最外层的 JSON 对象文本（首个 { 到最后一个 }）。
 * 模型偶发把 JSON 烘在解释文字或 <think> 块后面——抠出来仍要过 Zod，安全；
 * 抠不出（没有大括号）或抠出来是碎的（截断/多对象）就返回 null，走纠错重试。
 */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * 最后一搏：模型偶尔「提前收工」——finish_reason 说 stop，但 JSON 停在半截
 * （实测：开头完全合法、长度比同类完整样本短一截、解析在中途断掉）。
 * 按括号栈把缺的尾巴补上：断在字符串里先补引号，再补齐未闭合的 ] }，
 * 悬空的逗号/冒号尾巴清掉（冒号后补 null）。补完仍要过 Zod，安全；
 * 没什么可修（括号已平衡且不在字符串里）就返回 null，走纠错重试。
 */
export function repairTruncatedJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  const text = raw.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (!inString && stack.length === 0) return null;
  let repaired = text;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  if (/:\s*$/.test(repaired)) repaired += " null";
  while (stack.length) {
    repaired += stack.pop() === "{" ? "}" : "]";
  }
  return repaired;
}

/**
 * 兼容网关的 content 变体：字符串原样；多段数组（[{type:"text",text:…},…]）拼回一段。
 * 都不是就返回 null（结构异常，走重试）。
 */
function normalizeContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map(
        (part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : ""
      )
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  return null;
}

/** finish_reason=length 说明回复被长度上限掐断——JSON 八成缺了尾巴，报错里点名它。 */
function responseDetail(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ finish_reason?: unknown }> })?.choices?.[0];
  return choice?.finish_reason === "length" ? "回复超出长度上限被截断" : "";
}

/**
 * 把网关的真实坏响应打进服务端控制台 + 完整尸体落盘 `.data/llm-invalid/`——
 * 「文本不是合法 JSON」的缺陷往往藏在响应中段（头 300 字看着完全正常），
 * 没有全文就没法定位。只在失败路径触发，不打扰正常流量。
 */
function logInvalidResponse(stage: string, payload: unknown, raw?: string, parseError?: unknown) {
  const choice = (payload as { choices?: Array<{ finish_reason?: unknown; usage?: unknown }> })
    ?.choices?.[0];
  const finishReason = choice?.finish_reason;
  const parts = [`[llm] ${stage}`];
  if (finishReason !== undefined) parts.push(`finish_reason=${String(finishReason)}`);
  if (parseError !== undefined) {
    parts.push(`parse=${JSON.stringify(parseError instanceof Error ? parseError.message : String(parseError))}`);
  }
  if (typeof raw === "string") {
    parts.push(`长度=${raw.length}`, `开头=${JSON.stringify(raw.slice(0, 300))}`);
    try {
      const dir = join(process.cwd(), ".data", "llm-invalid");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(join(dir, `invalid-${stamp}.txt`), raw, "utf8");
      parts.push(`全文已存 .data/llm-invalid/invalid-${stamp}.txt`);
    } catch {
      parts.push("（尸体落盘失败，不影响主流程）");
    }
  }
  console.error(parts.join(" | "));
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

      const rawBody = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        logInvalidResponse("响应体不是合法 JSON", undefined, rawBody);
        detail = "响应体不是合法 JSON";
        correctiveNote = RETRY_NOTE;
        continue;
      }

      const choices = (payload as { choices?: unknown })?.choices;
      const rawContent = Array.isArray(choices)
        ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
        : undefined;
      const content = normalizeContent(rawContent);
      if (content === null) {
        logInvalidResponse(
          "回复内容为空或格式异常",
          payload,
          typeof rawContent === "string" ? rawContent : undefined
        );
        detail = responseDetail(payload) || "回复内容为空或格式异常";
        correctiveNote = RETRY_NOTE;
        continue;
      }

      const text = stripJsonFences(content);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        // 直接解析失败 → 两级抢救：① 掐头去尾（散文包裹/<think> 块后面的 JSON）；
        // ② 截断修复（模型提前收工，按括号栈补齐缺尾）。修完仍要过 Zod。
        const salvaged = extractJsonObject(text);
        const candidates = [salvaged, repairTruncatedJson(text)];
        for (const candidate of candidates) {
          if (parsed !== undefined || !candidate) continue;
          try {
            parsed = JSON.parse(candidate);
          } catch {
            parsed = undefined;
          }
        }
        if (parsed === undefined) {
          logInvalidResponse("文本不是合法 JSON", payload, text, parseError);
          detail = responseDetail(payload) || "文本不是合法 JSON";
          correctiveNote =
            "上一次的文本不是合法 JSON——可能带了 Markdown 代码围栏或前后多余文字。" + RETRY_NOTE;
          continue;
        }
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
