import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { collectEnvExtraImageSites, withProviderOverrides } from "@/features/settings/provider-settings";
import { loadProviderOverrides } from "./settings-store";
import { DEFAULT_IMAGE_BASE_URL, DEFAULT_IMAGE_MODEL, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from "@/features/settings/provider-settings";

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
  LLM_BASE_URL: z.url().default(DEFAULT_LLM_BASE_URL),
  LLM_API_KEY: z.string().default(""),
  // 全场景默认模型：正文/大纲/审核/视觉规划/研究/看图统一走它；各 LLM_*_MODEL 可单独覆盖。
  LLM_MODEL: z.string().default(DEFAULT_LLM_MODEL),
  LLM_MODELS: z.string().default(""),
  LLM_RESEARCH_MODEL: z.string().default(""),
  LLM_REVIEW_MODEL: z.string().default(""),
  LLM_VISUAL_MODEL: z.string().default(""),
  LLM_VISION_MODEL: z.string().default(""),
  IMAGE_BASE_URL: z.url().default(DEFAULT_IMAGE_BASE_URL),
  IMAGE_API_KEY: z.string().default(""),
  IMAGE_MODEL: z.string().default(DEFAULT_IMAGE_MODEL),
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
    // 额外生图站点（IMAGE2_/IMAGE3_/…）从原始 env 动态扫描：面板可增删任意数量，
    // zod schema 只声明主站三键，避免与扫描结果双算。model 缺省时已回落 IMAGE_MODEL。
    extraImageSites: collectEnvExtraImageSites(env).map((site, index) =>
      provider(site.baseUrl, site.apiKey, site.model, `IMAGE${index + 2}`)!
    ),
    wechat:
      value.WECHAT_APPID.trim() && value.WECHAT_APPSECRET.trim()
        ? { appId: value.WECHAT_APPID.trim(), appSecret: value.WECHAT_APPSECRET.trim() }
        : null
  };
}

export function getServerConfig() {
  loadWorkspaceEnv();
  // 设置面板覆盖层（app_settings 表）优先于 env 默认层；读取失败或无覆盖行时 env 原样生效。
  return parseServerConfig(withProviderOverrides(process.env, loadProviderOverrides()));
}

/** 设置面板 API 用的 env 快照：确保 workspace env 文件已加载后返回 process.env。 */
export function getWorkspaceEnv(): NodeJS.ProcessEnv {
  loadWorkspaceEnv();
  return process.env;
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
