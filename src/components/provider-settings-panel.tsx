"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import type {
  ImageSettings,
  LlmSettings,
  MaskedProviderSettings
} from "@/features/settings/provider-settings";

const API_BASE = "/api/settings/providers";

export interface ProviderSettingsPanelProps {
  initialSettings: MaskedProviderSettings;
  initialUpdatedAt: string | null;
  /** 测试注入；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 保存成功后由调用方刷新页面数据（生产注入 router.refresh）。 */
  onSaved?: () => void;
}

interface SaveSuccess {
  updatedAt: string;
  settings: MaskedProviderSettings;
}

interface ApiResponse {
  status: number;
  ok: boolean;
  payload: unknown;
}

type TestOutcome =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; models: string[] }
  | { status: "error"; message: string };

const emptyLlm: LlmSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  models: "",
  researchModel: "",
  reviewModel: "",
  visualModel: "",
  visionModel: ""
};

const emptyImage: ImageSettings = { baseUrl: "", apiKey: "", model: "" };

const SOURCE_LABELS: Record<string, string> = {
  panel: "面板配置",
  env: "环境变量",
  none: "未配置"
};

function sourceBadgeClass(source: string) {
  return `source-badge source-badge-${source}`;
}

/** 去掉来源标记：来源是页面加载时的快照语义，不属于可编辑的表单值。 */
function stripSource<T extends { source: string }>(value: T): Omit<T, "source"> {
  const rest = { ...value };
  delete (rest as { source?: string }).source;
  return rest;
}

function llmFromMasked(masked: NonNullable<MaskedProviderSettings["llm"]>): LlmSettings {
  return stripSource(masked);
}

function imageFromMasked(masked: ImageSettings & { source: string }): ImageSettings {
  return stripSource(masked);
}

function readError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  return fallback;
}

/** LLM 模型分工字段：字段名 → 展示说明。 */
const LLM_ROLE_FIELDS = [
  { name: "researchModel", label: "资料搜集模型", hint: "联网搜集资料等深度研究任务" },
  { name: "reviewModel", label: "审核模型", hint: "大纲/正文审核等打分类任务，可用轻量快模型" },
  { name: "visualModel", label: "配图规划模型", hint: "配图提示词规划，输出 JSON" },
  { name: "visionModel", label: "看图模型", hint: "参考形象提取等看图任务，需支持图片输入" }
] as const;

export function ProviderSettingsPanel({
  initialSettings,
  initialUpdatedAt,
  fetchImpl,
  onSaved
}: ProviderSettingsPanelProps) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  /** 来源徽章的当前快照：保存成功后随响应刷新（initialSettings 只是页面加载时的值）。 */
  const [sourceSnapshot, setSourceSnapshot] = useState<MaskedProviderSettings>(initialSettings);
  const [llm, setLlm] = useState<LlmSettings>(
    () => (initialSettings.llm ? llmFromMasked(initialSettings.llm) : emptyLlm)
  );
  const [image, setImage] = useState<ImageSettings>(
    () => (initialSettings.image ? imageFromMasked(initialSettings.image) : emptyImage)
  );
  const [extraSites, setExtraSites] = useState<ImageSettings[]>(() =>
    initialSettings.extraImageSites.map(imageFromMasked)
  );
  const [llmTest, setLlmTest] = useState<TestOutcome>({ status: "idle" });
  const [imageTest, setImageTest] = useState<TestOutcome>({ status: "idle" });
  const [discoveredLlmModels, setDiscoveredLlmModels] = useState<string[]>([]);
  const [discoveredImageModels, setDiscoveredImageModels] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const llmModelOptions = useMemo(() => {
    const base = [...llm.models.split(",").map((item) => item.trim()), llm.model].filter(Boolean);
    return Array.from(new Set([...base, ...discoveredLlmModels]));
  }, [llm.models, llm.model, discoveredLlmModels]);

  const imageModelOptions = useMemo(
    () => Array.from(new Set([image.model, ...discoveredImageModels].filter(Boolean))),
    [image.model, discoveredImageModels]
  );

  async function request(path: string, init: RequestInit): Promise<ApiResponse> {
    const response = await doFetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init
    });
    const payload: unknown = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, payload };
  }

  async function saveProvider(patch: Record<string, unknown>) {
    setSaving(true);
    setStatusMessage(null);
    try {
      const { status, ok, payload } = await request("", {
        method: "PUT",
        body: JSON.stringify({ ...patch, expectedUpdatedAt: updatedAt ?? "" })
      });
      if (!ok) {
        setStatusMessage({
          tone: "error",
          text: status === 409 ? "配置已被其他窗口修改，请刷新页面后重试" : readError(payload, "保存失败，请稍后重试")
        });
        return;
      }
      const success = payload as SaveSuccess;
      setUpdatedAt(success.updatedAt);
      setSourceSnapshot(success.settings);
      setLlm(success.settings.llm ? llmFromMasked(success.settings.llm) : emptyLlm);
      setImage(success.settings.image ? imageFromMasked(success.settings.image) : emptyImage);
      setExtraSites(success.settings.extraImageSites.map(imageFromMasked));
      setLlmTest({ status: "idle" });
      setImageTest({ status: "idle" });
      setStatusMessage({ tone: "ok", text: "配置已保存并即时生效" });
      onSaved?.();
    } catch {
      setStatusMessage({ tone: "error", text: "网络异常，保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(scope: "llm" | "image", site: { baseUrl: string; apiKey: string }) {
    const setOutcome = scope === "llm" ? setLlmTest : setImageTest;
    setOutcome({ status: "testing" });
    try {
      const { ok, payload } = await request("/test", {
        method: "POST",
        body: JSON.stringify({ scope, baseUrl: site.baseUrl, apiKey: site.apiKey })
      });
      if (ok && (payload as { ok?: boolean })?.ok) {
        const models = (payload as { models?: unknown }).models;
        const list = Array.isArray(models) ? models.filter((m): m is string => typeof m === "string") : [];
        if (scope === "llm") setDiscoveredLlmModels(list);
        else setDiscoveredImageModels(list);
        setOutcome({ status: "ok", models: list });
      } else {
        setOutcome({ status: "error", message: readError(payload, "连接失败") });
      }
    } catch {
      setOutcome({ status: "error", message: "网络异常，连接测试失败" });
    }
  }

  function renderTestOutcome(outcome: TestOutcome) {
    if (outcome.status === "idle") return null;
    if (outcome.status === "testing") {
      return <span className="provider-test testing"><Loader2 size={14} className="spin" aria-hidden="true" /> 测试中…</span>;
    }
    if (outcome.status === "ok") {
      return <span className="provider-test ok"><Check size={14} aria-hidden="true" /> 连接成功 · 发现 {outcome.models.length} 个模型</span>;
    }
    return <span className="provider-test error" role="alert">{outcome.message}</span>;
  }

  return (
    <section className="page-section settings-page" aria-labelledby="settings-title">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">系统设置</p>
          <h1 id="settings-title">Provider 设置</h1>
        </div>
        <button className="button button-primary" type="button" disabled={saving}
          onClick={() => saveProvider({ llm, image, extraImageSites: extraSites })}>
          保存全部
        </button>
      </div>
      <p className="settings-intro">
        面板保存的配置优先于 <code>env/.env.local</code>；「环境变量」徽章表示该项当前由环境文件生效。
        保存后立即生效，无需重启；把某项清空并配合「恢复环境变量默认」可回落到环境文件。
      </p>
      {statusMessage && (
        <p className={`settings-status ${statusMessage.tone}`} role="status">{statusMessage.text}</p>
      )}

      <div className="settings-grid">
        <fieldset className="provider-card" aria-label="LLM 网关">
          <legend>LLM 网关</legend>
          <div className="provider-card-head">
            <span className={sourceBadgeClass(sourceSnapshot.llm?.source ?? "none")}>
              {SOURCE_LABELS[sourceSnapshot.llm?.source ?? "none"]}
            </span>
            {sourceSnapshot.llm?.source === "panel" && (
              <button className="button button-secondary" type="button" disabled={saving}
                onClick={() => saveProvider({ llm: null })}>
                恢复环境变量默认
              </button>
            )}
          </div>
          <p className="provider-hint">未配置时，全部生成/审核功能走内置演示适配器（内容为确定性占位）。</p>

          <div className="form-field">
            <label htmlFor="llm-base-url">服务地址</label>
            <input id="llm-base-url" type="url" value={llm.baseUrl}
              onChange={(event) => setLlm({ ...llm, baseUrl: event.target.value })}
              placeholder="https://yelan.xiaobupao.cn" />
          </div>
          <div className="form-field">
            <label htmlFor="llm-api-key">API Key</label>
            <input id="llm-api-key" type="text" className="mono" value={llm.apiKey} autoComplete="off"
              onChange={(event) => setLlm({ ...llm, apiKey: event.target.value })} />
            {llm.apiKey.startsWith("••••") && (
              <p className="field-hint">显示为掩码，保存时沿用已保存的真值；粘贴新值即可替换。</p>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="llm-model">默认模型</label>
            <input id="llm-model" list="llm-model-options" value={llm.model}
              onChange={(event) => setLlm({ ...llm, model: event.target.value })} />
            <datalist id="llm-model-options">
              {llmModelOptions.map((model) => <option key={model} value={model} />)}
            </datalist>
            <p className="field-hint">正文/大纲生成等主任务的模型；其余分工留空时回落到它。</p>
          </div>
          <div className="form-field">
            <label htmlFor="llm-models">补充模型列表</label>
            <input id="llm-models" value={llm.models}
              onChange={(event) => setLlm({ ...llm, models: event.target.value })}
              placeholder="逗号分隔，如 gemini-3.8-flash, grok-4.6" />
          </div>
          <div className="provider-role-grid">
            {LLM_ROLE_FIELDS.map((field) => (
              <div className="form-field" key={field.name}>
                <label htmlFor={`llm-${field.name}`}>{field.label}</label>
                <input id={`llm-${field.name}`} list="llm-model-options" value={llm[field.name]}
                  onChange={(event) => setLlm({ ...llm, [field.name]: event.target.value })} />
                <p className="field-hint">{field.hint}</p>
              </div>
            ))}
          </div>
          <div className="provider-actions">
            <button className="button button-secondary" type="button"
              onClick={() => testConnection("llm", llm)} disabled={llmTest.status === "testing"}>
              测试连接
            </button>
            {renderTestOutcome(llmTest)}
          </div>
        </fieldset>

        <fieldset className="provider-card" aria-label="图片生成">
          <legend>图片生成</legend>
          <div className="provider-card-head">
            <span className={sourceBadgeClass(sourceSnapshot.image?.source ?? "none")}>
              {SOURCE_LABELS[sourceSnapshot.image?.source ?? "none"]}
            </span>
            {sourceSnapshot.image?.source === "panel" && (
              <button className="button button-secondary" type="button" disabled={saving}
                onClick={() => saveProvider({ image: null })}>
                恢复环境变量默认
              </button>
            )}
          </div>
          <p className="provider-hint">未配置时，配图生成按钮会提示无法生成；其余功能不受影响。</p>

          <div className="form-field">
            <label htmlFor="image-base-url">主站服务地址</label>
            <input id="image-base-url" type="url" value={image.baseUrl}
              onChange={(event) => setImage({ ...image, baseUrl: event.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor="image-api-key">主站 API Key</label>
            <input id="image-api-key" type="text" className="mono" value={image.apiKey} autoComplete="off"
              onChange={(event) => setImage({ ...image, apiKey: event.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor="image-model">生成模型</label>
            <input id="image-model" list="image-model-options" value={image.model}
              onChange={(event) => setImage({ ...image, model: event.target.value })} />
            <datalist id="image-model-options">
              {imageModelOptions.map((model) => <option key={model} value={model} />)}
            </datalist>
          </div>
          <div className="provider-actions">
            <button className="button button-secondary" type="button"
              onClick={() => testConnection("image", image)} disabled={imageTest.status === "testing"}>
              测试连接
            </button>
            {renderTestOutcome(imageTest)}
          </div>

          <h3 className="extra-sites-title">额外生图站点</h3>
          <p className="provider-hint">生图模型下拉会聚合所有站点；生成时按模型归属自动路由。</p>
          {extraSites.map((site, index) => (
            <div className="site-row" key={index} aria-label={`额外生图站点 ${index + 1}`}>
              <div className="form-field">
                <label htmlFor={`site-${index}-base-url`}>站点 {index + 1} 服务地址</label>
                <input id={`site-${index}-base-url`} type="url" value={site.baseUrl}
                  onChange={(event) => {
                    const next = [...extraSites];
                    next[index] = { ...site, baseUrl: event.target.value };
                    setExtraSites(next);
                  }} />
              </div>
              <div className="form-field">
                <label htmlFor={`site-${index}-api-key`}>API Key</label>
                <input id={`site-${index}-api-key`} type="text" className="mono" value={site.apiKey} autoComplete="off"
                  onChange={(event) => {
                    const next = [...extraSites];
                    next[index] = { ...site, apiKey: event.target.value };
                    setExtraSites(next);
                  }} />
              </div>
              <div className="form-field">
                <label htmlFor={`site-${index}-model`}>默认模型</label>
                <input id={`site-${index}-model`} value={site.model}
                  onChange={(event) => {
                    const next = [...extraSites];
                    next[index] = { ...site, model: event.target.value };
                    setExtraSites(next);
                  }} />
              </div>
              <button className="button button-secondary site-remove" type="button" aria-label={`删除额外生图站点 ${index + 1}`}
                onClick={() => setExtraSites(extraSites.filter((_, i) => i !== index))}>
                <Trash2 size={14} aria-hidden="true" /> 移除
              </button>
            </div>
          ))}
          <button className="button button-secondary" type="button"
            onClick={() => setExtraSites([...extraSites, emptyImage])}>
            <Plus size={14} aria-hidden="true" /> 添加站点
          </button>
        </fieldset>
      </div>
    </section>
  );
}
