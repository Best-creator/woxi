"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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

interface ModelSelectProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** 可选模型候选（不含空值）。 */
  options: string[];
  /** 存在时渲染 value="" 的首位选项（如分工字段的「跟随默认模型」）。 */
  emptyOptionLabel?: string;
  /** 回落 input 模式的占位文案。 */
  placeholder?: string;
}

/** 模型选择控件：有候选时渲染下拉（当前值始终并入选项，不丢值），否则回落文本输入。 */
function ModelSelect({ id, value, onChange, options, emptyOptionLabel, placeholder }: ModelSelectProps) {
  const hasEmptyOption = Boolean(emptyOptionLabel) || value === "";
  const pickable = options.length + (hasEmptyOption ? 1 : 0) >= 2;
  if (!pickable) {
    return (
      <input id={id} type="text" value={value} placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)} />
    );
  }
  const merged = Array.from(new Set([...(value ? [value] : []), ...options])).filter(Boolean);
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {hasEmptyOption && <option value="">{emptyOptionLabel ?? "请选择模型"}</option>}
      {merged.map((model) => <option key={model} value={model}>{model}</option>)}
    </select>
  );
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
  const [siteModels, setSiteModels] = useState<Record<number, string[]>>({});
  const [siteTests, setSiteTests] = useState<Record<number, TestOutcome>>({});
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

  function applyDiscovered(scope: "llm" | "image", models: string[]) {
    if (scope === "llm") setDiscoveredLlmModels(models);
    else setDiscoveredImageModels(models);
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
      // 保存后用刚生效的配置重拉模型列表（掩码 key 由服务端解析回真值）。
      const savedLlm = success.settings.llm ? llmFromMasked(success.settings.llm) : emptyLlm;
      const savedImage = success.settings.image ? imageFromMasked(success.settings.image) : emptyImage;
      if (savedLlm.baseUrl && savedLlm.apiKey) void testConnection("llm", savedLlm);
      if (savedImage.baseUrl && savedImage.apiKey) void testConnection("image", savedImage);
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
        applyDiscovered(scope, list);
        setOutcome({ status: "ok", models: list });
      } else {
        setOutcome({ status: "error", message: readError(payload, "连接失败") });
      }
    } catch {
      setOutcome({ status: "error", message: "网络异常，连接测试失败" });
    }
  }

  async function testSiteConnection(index: number, site: { baseUrl: string; apiKey: string }) {
    setSiteTests((prev) => ({ ...prev, [index]: { status: "testing" } }));
    try {
      const { ok, payload } = await request("/test", {
        method: "POST",
        body: JSON.stringify({ scope: "image", baseUrl: site.baseUrl, apiKey: site.apiKey })
      });
      if (ok && (payload as { ok?: boolean })?.ok) {
        const models = (payload as { models?: unknown }).models;
        const list = Array.isArray(models) ? models.filter((m): m is string => typeof m === "string") : [];
        setSiteModels((prev) => ({ ...prev, [index]: list }));
        setSiteTests((prev) => ({ ...prev, [index]: { status: "ok", models: list } }));
      } else {
        setSiteTests((prev) => ({ ...prev, [index]: { status: "error", message: readError(payload, "连接失败") } }));
      }
    } catch {
      setSiteTests((prev) => ({ ...prev, [index]: { status: "error", message: "网络异常，连接测试失败" } }));
    }
  }

  function removeExtraSite(index: number) {
    setExtraSites(extraSites.filter((_, i) => i !== index));
    // 站点按数组下标索引，删除后下标移位，直接清空缓存避免错位。
    setSiteModels({});
    setSiteTests({});
  }

  // 挂载时用初始快照自动拉取一次模型列表（掩码 key 由服务端解析回真值）。
  useEffect(() => {
    if (initialSettings.llm?.baseUrl && initialSettings.llm.apiKey) {
      void testConnection("llm", {
        baseUrl: initialSettings.llm.baseUrl,
        apiKey: initialSettings.llm.apiKey
      });
    }
    if (initialSettings.image?.baseUrl && initialSettings.image.apiKey) {
      void testConnection("image", {
        baseUrl: initialSettings.image.baseUrl,
        apiKey: initialSettings.image.apiKey
      });
    }
    // 仅挂载时执行一次；故意只依赖初始快照。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function renderSiteOutcome(index: number) {
    const outcome = siteTests[index];
    if (!outcome || outcome.status === "idle") return null;
    if (outcome.status === "testing") {
      return <span className="provider-test testing"><Loader2 size={12} className="spin" aria-hidden="true" /> 拉取中…</span>;
    }
    if (outcome.status === "ok") {
      return <span className="provider-test ok">站点可用 · {outcome.models.length} 个模型</span>;
    }
    return <span className="provider-test error" role="alert">{outcome.message}</span>;
  }

  function renderRefreshButton(label: string, onClick: () => void, testing: boolean) {
    return (
      <button className="button button-secondary model-refresh" type="button" aria-label={label}
        title={label} onClick={onClick} disabled={testing}>
        <RefreshCw size={13} className={testing ? "spin" : undefined} aria-hidden="true" />
      </button>
    );
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
        打开页面会自动从网关拉取可用模型列表供下拉选择；保存后立即生效并重新拉取。
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
            <div className="model-field-row">
              <ModelSelect id="llm-model" value={llm.model} options={llmModelOptions}
                placeholder="如 gemini-3.8-flash"
                onChange={(model) => setLlm({ ...llm, model })} />
              {renderRefreshButton("拉取 LLM 模型列表", () => void testConnection("llm", llm), llmTest.status === "testing")}
            </div>
            <p className="field-hint">正文/大纲生成等主任务的模型；其余分工留空时回落到它。</p>
          </div>
          <div className="form-field">
            <label htmlFor="llm-models">补充模型列表</label>
            <input id="llm-models" value={llm.models}
              onChange={(event) => setLlm({ ...llm, models: event.target.value })}
              placeholder="逗号分隔，如 gemini-3.8-flash, grok-4.6" />
            <p className="field-hint">这里填写的模型会并入上方所有下拉选项。</p>
          </div>
          <div className="provider-role-grid">
            {LLM_ROLE_FIELDS.map((field) => (
              <div className="form-field" key={field.name}>
                <label htmlFor={`llm-${field.name}`}>{field.label}</label>
                <ModelSelect id={`llm-${field.name}`} value={llm[field.name]} options={llmModelOptions}
                  emptyOptionLabel="跟随默认模型"
                  onChange={(next) => setLlm({ ...llm, [field.name]: next })} />
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
            <div className="model-field-row">
              <ModelSelect id="image-model" value={image.model} options={imageModelOptions}
                placeholder="如 gpt-image-2"
                onChange={(model) => setImage({ ...image, model })} />
              {renderRefreshButton("拉取生图模型列表", () => void testConnection("image", image), imageTest.status === "testing")}
            </div>
            <p className="field-hint">下拉选项由网关实时拉取；生成时按模型归属自动路由站点。</p>
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
                <label htmlFor={`site-${index}-model`}>站点 {index + 1} 默认模型</label>
                <div className="model-field-row">
                  <ModelSelect id={`site-${index}-model`} value={site.model}
                    options={Array.from(new Set([site.model, ...(siteModels[index] ?? [])].filter(Boolean)))}
                    placeholder="如 gpt-image-2"
                    onChange={(model) => {
                      const next = [...extraSites];
                      next[index] = { ...site, model };
                      setExtraSites(next);
                    }} />
                  {renderRefreshButton(
                    `拉取站点 ${index + 1} 模型列表`,
                    () => void testSiteConnection(index, site),
                    siteTests[index]?.status === "testing"
                  )}
                </div>
                {renderSiteOutcome(index)}
              </div>
              <button className="button button-secondary site-remove" type="button" aria-label={`删除额外生图站点 ${index + 1}`}
                onClick={() => removeExtraSite(index)}>
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
