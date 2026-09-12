import { rememberDiscoveredLlmModels } from "./config";
import type { LlmProviderConfig, PublicLlmConfig, ServerConfig } from "./config";
import { LlmError } from "@/features/llm/errors";

type ModelsResponse = { data?: Array<{ id?: unknown }> };

function compareModelNames(left: string, right: string) {
  const leftParts = left.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const rightParts = right.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
      return rightNumber - leftNumber;
    }
    if (leftPart !== rightPart) return rightPart.localeCompare(leftPart);
  }
  return 0;
}

export function pickPreferredModel(models: string[]) {
  const geminiModels = models.filter((model) => model.toLowerCase().includes("gemini"));
  return [...(geminiModels.length ? geminiModels : models)].sort(compareModelNames)[0] ?? null;
}

export async function discoverLlmModels(
  config: LlmProviderConfig,
  fetchFn: typeof fetch = fetch
) {
  let response: Response;
  try {
    response = await fetchFn(`${config.baseUrl}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new LlmError("timeout", "模型列表请求超时，请稍后重试。");
    }
    throw new LlmError("upstream", "模型列表暂时不可用，请稍后重试。");
  }
  if (response.status === 401 || response.status === 403) {
    throw new LlmError("authentication", "语言模型服务认证失败，请检查服务配置。");
  }
  if (!response.ok) throw new LlmError("upstream", "模型列表暂时不可用，请稍后重试。");

  let payload: ModelsResponse;
  try {
    payload = (await response.json()) as ModelsResponse;
  } catch {
    throw new LlmError("invalid_response", "模型列表格式无效，请稍后重试。");
  }
  if (!Array.isArray(payload.data)) {
    throw new LlmError("invalid_response", "模型列表格式无效，请稍后重试。");
  }
  const models = [...new Set(payload.data
    .map((item) => typeof item.id === "string" ? item.id.trim() : "")
    .filter(Boolean))];
  if (!models.length) throw new LlmError("invalid_response", "服务未返回可用模型。");
  rememberDiscoveredLlmModels(config.baseUrl, models);
  return models;
}

export async function getPublicLlmConfigWithDiscovery(
  config: ServerConfig,
  fetchFn: typeof fetch = fetch
): Promise<PublicLlmConfig> {
  if (!config.llm) return { enabled: false, availableModels: [], defaultModel: null };
  try {
    const models = await discoverLlmModels(config.llm, fetchFn);
    return { enabled: true, availableModels: models, defaultModel: pickPreferredModel(models) };
  } catch {
    const models = config.llm.availableModels;
    return { enabled: true, availableModels: models, defaultModel: pickPreferredModel(models) ?? (config.llm.model || null) };
  }
}
