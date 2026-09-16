import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmProviderConfig extends ProviderConfig {
  availableModels: string[];
  /** 联网搜集资料等深度研究任务使用的模型；为空时回落到 model。 */
  researchModel: string;
  /** 大纲/正文审核等打分类任务使用的模型；为空时回落到 model。审核不需要深度推理，可配轻量快模型。 */
  reviewModel: string;
  /** 配图视觉规划等结构化输出任务使用的模型；为空时回落到 model。规划输出 JSON，深度推理模型慢且易超时。 */
  visualModel: string;
  /** 从参考图提取形象等看图任务使用的模型；为空时回落到 model。需要模型本身支持图片输入。 */
  visionModel: string;
}

export interface ServerConfig {
  databasePath: string;
  llm: LlmProviderConfig | null;
  image: ProviderConfig | null;
  /** 额外生图站点（IMAGE2_* 配置）：UI 模型下拉里可跨站选模型，生成时按模型归属路由。 */
  extraImageSites: ProviderConfig[];
  /** 公众号草稿箱推送凭据；两个变量都配置时才启用。 */
  wechat: { appId: string; appSecret: string } | null;
}

export interface PublicLlmConfig {
  enabled: boolean;
  availableModels: string[];
  defaultModel: string | null;
}

const envSchema = z.object({
  CONTENT_DB_PATH: z.string().min(1).default(".data/content-platform.db"),
  LLM_BASE_URL: z.url().default("https://yelan.xiaobupao.cn"),
  LLM_API_KEY: z.string().default(""),
  // 全场景默认模型：正文/大纲/审核/视觉规划/研究/看图统一走它；各 LLM_*_MODEL 可单独覆盖。
  LLM_MODEL: z.string().default("gemini-3.8-flash"),
  LLM_MODELS: z.string().default(""),
  LLM_RESEARCH_MODEL: z.string().default(""),
  LLM_REVIEW_MODEL: z.string().default(""),
  LLM_VISUAL_MODEL: z.string().default(""),
  LLM_VISION_MODEL: z.string().default(""),
  IMAGE_BASE_URL: z.url().default("https://image2.xiaobupao.cn"),
  IMAGE_API_KEY: z.string().default(""),
  IMAGE_MODEL: z.string().default("gpt-image-2"),
  IMAGE2_BASE_URL: z.url().optional(),
  IMAGE2_API_KEY: z.string().default(""),
  IMAGE2_MODEL: z.string().default(""),
  WECHAT_APPID: z.string().default(""),
  WECHAT_APPSECRET: z.string().default("")
});

let workspaceEnvLoaded = false;
const discoveredLlmModels = new Map<string, { models: string[]; discoveredAt: number }>();
/** 模型发现结果的有效期：有效期内复用缓存，避免每次页面渲染都请求上游 /v1/models。 */
const DISCOVERY_TTL_MS = 10 * 60_000;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

export function rememberDiscoveredLlmModels(baseUrl: string, models: string[]) {
  discoveredLlmModels.set(normalizeBaseUrl(baseUrl), {
    models: Array.from(new Set(models.filter(Boolean))),
    discoveredAt: Date.now()
  });
}

/** TTL 内的模型发现结果；过期或不存在时返回空数组。 */
export function freshDiscoveredLlmModels(baseUrl: string) {
  const entry = discoveredLlmModels.get(normalizeBaseUrl(baseUrl));
  if (!entry || Date.now() - entry.discoveredAt > DISCOVERY_TTL_MS) return [];
  return [...entry.models];
}

function loadWorkspaceEnv() {
  if (workspaceEnvLoaded) return;
  const path = resolve(process.cwd(), "env", ".env.local");
  if (existsSync(path)) loadEnvFile(path);
  workspaceEnvLoaded = true;
}

function provider(baseUrl: string, apiKey: string, model: string, label: string, requireModel = true) {
  if (!apiKey.trim()) return null;
  if (requireModel && !model.trim()) throw new Error(`${label}_MODEL 必须在配置密钥后填写`);
  return { baseUrl: normalizeBaseUrl(baseUrl), apiKey, model };
}

function llmProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
  models: string,
  researchModel: string,
  reviewModel: string,
  visualModel: string,
  visionModel: string
): LlmProviderConfig | null {
  const config = provider(baseUrl, apiKey, model, "LLM", false);
  if (!config) return null;

  const availableModels = Array.from(new Set([
    ...models.split(",").map((item) => item.trim()).filter(Boolean),
    ...freshDiscoveredLlmModels(config.baseUrl)
  ]));
  if (config.model.trim() && !availableModels.includes(config.model)) availableModels.push(config.model);
  return {
    ...config,
    availableModels,
    researchModel: researchModel.trim(),
    reviewModel: reviewModel.trim(),
    visualModel: visualModel.trim(),
    visionModel: visionModel.trim()
  };
}

export function parseServerConfig(env: NodeJS.ProcessEnv): ServerConfig;
export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig;
export function parseServerConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): ServerConfig {
  const value = envSchema.parse(env);
  return {
    databasePath: value.CONTENT_DB_PATH,
    llm: llmProvider(
      value.LLM_BASE_URL,
      value.LLM_API_KEY,
      value.LLM_MODEL,
      value.LLM_MODELS,
      value.LLM_RESEARCH_MODEL,
      value.LLM_REVIEW_MODEL,
      value.LLM_VISUAL_MODEL,
      value.LLM_VISION_MODEL
    ),
    image: provider(value.IMAGE_BASE_URL, value.IMAGE_API_KEY, value.IMAGE_MODEL, "IMAGE"),
    extraImageSites: value.IMAGE2_BASE_URL && value.IMAGE2_API_KEY.trim()
      ? [
          provider(
            value.IMAGE2_BASE_URL,
            value.IMAGE2_API_KEY,
            value.IMAGE2_MODEL || value.IMAGE_MODEL,
            "IMAGE2"
          )!
        ]
      : [],
    wechat:
      value.WECHAT_APPID.trim() && value.WECHAT_APPSECRET.trim()
        ? { appId: value.WECHAT_APPID.trim(), appSecret: value.WECHAT_APPSECRET.trim() }
        : null
  };
}

export function getServerConfig() {
  loadWorkspaceEnv();
  return parseServerConfig(process.env);
}

export function toPublicLlmConfig(config: ServerConfig): PublicLlmConfig {
  if (!config.llm) {
    return { enabled: false, availableModels: [], defaultModel: null };
  }
  return {
    enabled: true,
    availableModels: config.llm.availableModels,
    defaultModel: config.llm.model
  };
}

export function getPublicLlmConfig(): PublicLlmConfig {
  return toPublicLlmConfig(getServerConfig());
}
