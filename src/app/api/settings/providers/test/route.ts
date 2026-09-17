import { z } from "zod";
import { LlmError } from "@/features/llm/errors";
import { collectEnvExtraImageSites, isMaskedApiKey } from "@/features/settings/provider-settings";
import type { LlmProviderConfig } from "@/server/config";
import { getWorkspaceEnv } from "@/server/config";
import { discoverLlmModels } from "@/server/llm-models";
import { loadProviderOverrides } from "@/server/settings-store";

export const runtime = "nodejs";

const testRequestSchema = z.object({
  scope: z.enum(["llm", "image"]),
  baseUrl: z.url("服务地址必须是合法 URL"),
  apiKey: z.string().min(1),
  model: z.string().optional()
});

/** 掩码 apiKey 的存量解析（与 PUT 同一语义）：覆盖行优先、baseUrl 精确匹配、最后 env。 */
function resolveStoredKey(scope: "llm" | "image", baseUrl: string, submitted: string): string | null {
  if (!isMaskedApiKey(submitted)) return submitted;
  const overrides = loadProviderOverrides();
  const env = getWorkspaceEnv();
  if (scope === "llm") return overrides?.llm?.apiKey ?? env.LLM_API_KEY ?? null;
  const extraMatch =
    overrides?.extraImageSites?.find((site) => site.baseUrl === baseUrl)
    ?? collectEnvExtraImageSites(env).find((candidate) => candidate.baseUrl === baseUrl);
  return extraMatch?.apiKey ?? overrides?.image?.apiKey ?? env.IMAGE_API_KEY ?? null;
}

function toLlmProviderConfig(baseUrl: string, apiKey: string): LlmProviderConfig {
  return {
    baseUrl,
    apiKey,
    model: "",
    availableModels: [],
    researchModel: "",
    reviewModel: "",
    visualModel: "",
    visionModel: ""
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
  }
  const parsed = testRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "请求体格式无效" }, { status: 400 });
  }

  const { scope, baseUrl } = parsed.data;
  const apiKey = resolveStoredKey(scope, baseUrl, parsed.data.apiKey);
  if (!apiKey) {
    return Response.json(
      { error: "密钥显示为掩码且找不到已保存的真值，请重新输入完整密钥" },
      { status: 400 }
    );
  }

  // LLM 网关与生图站点都是 OpenAI 兼容的 /v1/models 语义，同一套探测逻辑。
  try {
    const models = await discoverLlmModels(toLlmProviderConfig(baseUrl, apiKey), fetch, { force: true });
    return Response.json({ ok: true, models });
  } catch (error) {
    if (error instanceof LlmError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    return Response.json({ error: "连接测试失败，请稍后重试" }, { status: 502 });
  }
}
