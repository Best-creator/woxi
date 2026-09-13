import { freshDiscoveredLlmModels, rememberDiscoveredLlmModels, toPublicLlmConfig } from "./config";
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
  fetchFn: typeof fetch = fetch,
  options: { force?: boolean } = {}
) {
  // 有效期内直接复用缓存；手动刷新等场景用 force 跳过缓存强拉上游。
  if (!options.force) {
    const cached = freshDiscoveredLlmModels(config.baseUrl);
    if (cached.length) return cached;
  }
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
    // 默认模型保持 env 配置的主模型（生成/改写类任务的既定选择），
    // 发现结果只扩充下拉列表的可选范围，不悄悄改默认值。
    return {
      enabled: true,
      availableModels: models,
      defaultModel: config.llm.model || pickPreferredModel(models)
    };
  } catch {
    // 发现失败（超时/上游故障）时回落 env 配置的静态列表，页面照常可用。
    return toPublicLlmConfig(config);
  }
}
