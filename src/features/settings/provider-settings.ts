import { z } from "zod";

/**
 * 设置面板的 provider 覆盖层（app_settings 表里的 provider_overrides 行）。
 *
 * 分层语义：env/.env.local 永远是默认层；面板保存的覆盖层整体接管对应键族
 * （LLM_* 全族 / IMAGE 主站三键 / IMAGE{N>=2} 额外站点族），字段级不做合并——
 * 表单所见即所得。某族为 null = 该族回落 env 默认；覆盖行不存在 = 全部回落 env。
 * 存储里的 apiKey 永远是真值；掩码只出现在 GET 响应与 UI 显示层。
 */

export const PROVIDER_SETTINGS_KEY = "provider_overrides";

/** 与 config.ts 的 envSchema 默认值一致：env 未显式配置时显示真实生效的默认模型。 */
export const DEFAULT_LLM_MODEL = "gemini-3.8-flash";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_LLM_BASE_URL = "https://yelan.xiaobupao.cn";
export const DEFAULT_IMAGE_BASE_URL = "https://image2.xiaobupao.cn";

/** 与 config.ts 的 llmProvider 覆盖键族一一对应（LLM_* 全部 8 键）。 */
export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 逗号分隔的补充模型列表（LLM_MODELS）；模型发现结果会在此基础上追加。 */
  models: string;
  researchModel: string;
  reviewModel: string;
  visualModel: string;
  visionModel: string;
}

/** 生图站点（主站或额外站点）：与 config.ts 的 provider(IMAGE_*) 对应。 */
export interface ImageSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** app_settings.value_json 的形状；缺省字段按 null 处理（回落 env）。 */
export interface ProviderOverrideValue {
  llm?: LlmSettings | null;
  image?: ImageSettings | null;
  extraImageSites?: ImageSettings[] | null;
}

const apiKeySchema = z.string().min(1, "API Key 不能为空");

export const llmSettingsSchema = z.object({
  baseUrl: z.url("服务地址必须是合法 URL"),
  apiKey: apiKeySchema,
  model: z.string().min(1, "默认模型不能为空"),
  models: z.string(),
  researchModel: z.string(),
  reviewModel: z.string(),
  visualModel: z.string(),
  visionModel: z.string()
});

export const imageSettingsSchema = z.object({
  baseUrl: z.url("服务地址必须是合法 URL"),
  apiKey: apiKeySchema,
  model: z.string().min(1, "生成模型不能为空")
});

export const providerSettingsPayloadSchema = z.object({
  llm: llmSettingsSchema.nullable().optional(),
  image: imageSettingsSchema.nullable().optional(),
  extraImageSites: z.array(imageSettingsSchema).nullable().optional(),
  /** 覆盖行的并发基准；空串表示基于「尚无覆盖行」。 */
  expectedUpdatedAt: z.string()
});

export type ProviderSettingsPayload = z.infer<typeof providerSettingsPayloadSchema>;

// ---------------------------------------------------------------------------
// 掩码：GET 响应与 UI 显示用「••••+尾4位」；PUT 提交掩码串 = 沿用存量真值。
// ---------------------------------------------------------------------------

const MASK_PREFIX = "••••";

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return MASK_PREFIX;
  return `${MASK_PREFIX}${apiKey.slice(-4)}`;
}

export function isMaskedApiKey(value: string): boolean {
  return value.startsWith(MASK_PREFIX);
}

/**
 * 解析 PUT 提交的 apiKey：非掩码原样返回；掩码换成存量真值；
 * 掩码但没有存量（旧配置来自 env，面板从未保存过）返回 null，由调用方报错。
 */
export function resolveSubmittedApiKey(submitted: string, stored: string | null): string | null {
  if (!isMaskedApiKey(submitted)) return submitted;
  return stored;
}

/** 把 UI 提交的 apiKey 解析成可存储的真值；无法解析时抛出带字段信息的错误。 */
export function requireStorableApiKey(submitted: string, stored: string | null, label: string): string {
  const resolved = resolveSubmittedApiKey(submitted, stored);
  if (!resolved) {
    throw new Error(`${label}的密钥显示为掩码且此前没有面板保存记录，请重新输入完整密钥`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// 表单值 ↔ env 键值：面板保存最终落成 env 键值覆盖，config.parseServerConfig 零分叉复用。
// ---------------------------------------------------------------------------

export function llmSettingsToEnv(settings: LlmSettings): Record<string, string> {
  return {
    LLM_BASE_URL: settings.baseUrl,
    LLM_API_KEY: settings.apiKey,
    LLM_MODEL: settings.model,
    LLM_MODELS: settings.models,
    LLM_RESEARCH_MODEL: settings.researchModel,
    LLM_REVIEW_MODEL: settings.reviewModel,
    LLM_VISUAL_MODEL: settings.visualModel,
    LLM_VISION_MODEL: settings.visionModel
  };
}

/** index 缺省 = 主站（IMAGE_*）；0 起算的额外站点序号 → IMAGE2_/IMAGE3_/…。 */
export function imageSettingsToEnv(settings: ImageSettings, index?: number): Record<string, string> {
  const prefix = index === undefined ? "IMAGE" : `IMAGE${index + 2}`;
  return {
    [`${prefix}_BASE_URL`]: settings.baseUrl,
    [`${prefix}_API_KEY`]: settings.apiKey,
    [`${prefix}_MODEL`]: settings.model
  };
}

// ---------------------------------------------------------------------------
// 覆盖合并：config.getServerConfig() 把 { ...process.env } 交给这里做键族接管。
// ---------------------------------------------------------------------------

const LLM_ENV_KEYS = Object.keys(llmSettingsToEnv({
  baseUrl: "",
  apiKey: "",
  model: "",
  models: "",
  researchModel: "",
  reviewModel: "",
  visualModel: "",
  visionModel: ""
}));

const IMAGE_MAIN_ENV_KEYS = ["IMAGE_BASE_URL", "IMAGE_API_KEY", "IMAGE_MODEL"];
/** 额外站点族：IMAGE2_/IMAGE3_/… 的 BASE_URL/API_KEY/MODEL（IMAGE\d+_ 不匹配 IMAGE_BASE_URL）。 */
const EXTRA_IMAGE_SITE_PATTERN = /^IMAGE\d+_(BASE_URL|API_KEY|MODEL)$/;

export function parseProviderOverrideJson(raw: string): ProviderOverrideValue | null {
  try {
    const value = JSON.parse(raw) as ProviderOverrideValue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * 把面板覆盖层合并进 env 副本：
 * - llm 存在 → 删除 env 全部 LLM_* 再放入表单值；null/缺省 → env 原样。
 * - image 存在 → 覆盖主站三键；null/缺省 → env 原样。
 * - extraImageSites 非 null（含空数组）→ 清掉 env 全部 IMAGE{N>=2} 三键组再按序放入；
 *   null/缺省 → env 的 IMAGE2_* 原样保留。
 * 覆盖行不存在（overrides 为 null）→ env 原样返回的副本。
 */
export function withProviderOverrides(
  env: Record<string, string | undefined>,
  overrides: ProviderOverrideValue | null
): Record<string, string | undefined> {
  const merged = { ...env };
  if (!overrides) return merged;

  if (overrides.llm) {
    for (const key of LLM_ENV_KEYS) delete merged[key];
    Object.assign(merged, llmSettingsToEnv(overrides.llm));
  }

  if (overrides.image) {
    for (const key of IMAGE_MAIN_ENV_KEYS) delete merged[key];
    Object.assign(merged, imageSettingsToEnv(overrides.image));
  }

  if (overrides.extraImageSites) {
    for (const key of Object.keys(merged)) {
      if (EXTRA_IMAGE_SITE_PATTERN.test(key)) delete merged[key];
    }
    overrides.extraImageSites.forEach((site, index) => {
      Object.assign(merged, imageSettingsToEnv(site, index));
    });
  }

  return merged;
}

// ---------------------------------------------------------------------------
// UI 展示形状（GET 响应 / 服务端页面直出）：真值全部掩码化。
// ---------------------------------------------------------------------------

export interface MaskedLlmSettings extends Omit<LlmSettings, "apiKey"> {
  apiKey: string;
  /** 此 provider 的生效来源：panel（面板覆盖）/ env（环境变量）/ none（未配置）。 */
  source: "panel" | "env" | "none";
}

export interface MaskedImageSettings extends ImageSettings {
  source: "panel" | "env" | "none";
}

export interface MaskedProviderSettings {
  llm: MaskedLlmSettings | null;
  image: MaskedImageSettings | null;
  extraImageSites: MaskedImageSettings[];
}

function maskedSource(hasOverride: boolean, hasEnv: boolean): "panel" | "env" | "none" {
  if (hasOverride) return "panel";
  return hasEnv ? "env" : "none";
}

/** 由覆盖值与 env 键值推导当前生效的掩码视图；面板值优先，env 兜底。 */
export function toMaskedProviderSettings(
  overrides: ProviderOverrideValue | null,
  env: Record<string, string | undefined>
): MaskedProviderSettings {
  const envValue = (key: string) => env[key]?.trim() ?? "";

  const overrideLlm = overrides?.llm ?? null;
  const hasEnvLlm = Boolean(envValue("LLM_API_KEY"));
  const llm = overrideLlm || (hasEnvLlm
    ? {
        baseUrl: envValue("LLM_BASE_URL") || DEFAULT_LLM_BASE_URL,
        apiKey: envValue("LLM_API_KEY"),
        model: envValue("LLM_MODEL") || DEFAULT_LLM_MODEL,
        models: envValue("LLM_MODELS"),
        researchModel: envValue("LLM_RESEARCH_MODEL"),
        reviewModel: envValue("LLM_REVIEW_MODEL"),
        visualModel: envValue("LLM_VISUAL_MODEL"),
        visionModel: envValue("LLM_VISION_MODEL")
      }
    : null);

  const overrideImage = overrides?.image ?? null;
  const hasEnvImage = Boolean(envValue("IMAGE_API_KEY"));
  const image = overrideImage || (hasEnvImage
    ? {
        baseUrl: envValue("IMAGE_BASE_URL") || DEFAULT_IMAGE_BASE_URL,
        apiKey: envValue("IMAGE_API_KEY"),
        model: envValue("IMAGE_MODEL") || DEFAULT_IMAGE_MODEL
      }
    : null);

  const overrideSites = overrides?.extraImageSites ?? null;
  const extraImageSites = overrideSites ?? collectEnvExtraImageSites(env);

  return {
    llm: llm && {
      ...llm,
      apiKey: maskApiKey(llm.apiKey),
      source: maskedSource(Boolean(overrideLlm), hasEnvLlm)
    },
    image: image && {
      ...image,
      apiKey: maskApiKey(image.apiKey),
      source: maskedSource(Boolean(overrideImage), hasEnvImage)
    },
    extraImageSites: extraImageSites.map((site) => ({
      ...site,
      apiKey: maskApiKey(site.apiKey),
      source: maskedSource(Boolean(overrideSites), true)
    }))
  };
}

/** 从 env 扫描 IMAGE{N>=2} 额外站点（与 config.ts 的解析规则一致：apiKey 缺失的组跳过）。 */
export function collectEnvExtraImageSites(
  env: Record<string, string | undefined>
): ImageSettings[] {
  const groups = new Map<number, { baseUrl?: string; apiKey?: string; model?: string }>();
  for (const [key, value] of Object.entries(env)) {
    const match = EXTRA_IMAGE_SITE_PATTERN.exec(key);
    if (!match) continue;
    const group = Number(key.slice("IMAGE".length, key.indexOf("_")));
    if (!Number.isInteger(group) || group < 2) continue;
    const entry = groups.get(group) ?? {};
    const field = key.slice(key.indexOf("_") + 1).toLowerCase();
    const fieldName = field === "base_url" ? "baseUrl" : field === "api_key" ? "apiKey" : "model";
    entry[fieldName] = value ?? "";
    groups.set(group, entry);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([, entry]) => {
      if (!entry.baseUrl?.trim() || !entry.apiKey?.trim()) return [];
      return [{
        baseUrl: entry.baseUrl.trim(),
        apiKey: entry.apiKey.trim(),
        model: (entry.model ?? "").trim() || envValueOf(env, "IMAGE_MODEL", DEFAULT_IMAGE_MODEL)
      }];
    });
}

function envValueOf(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}
