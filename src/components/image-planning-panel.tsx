"use client";

import { ImagePlus, MapPin, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ReferenceCharacter } from "@/features/characters/domain";
import type { ImageAsset, ImageAspectRatio } from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
import { ModelSelect } from "./model-select";

export interface ImageMutationPayload {
  article: Article;
  assets: ImageAsset[];
}

/** 规划引导参数：绘制风格与参考形象均为可选项。 */
export interface ImagePlanGuideOptions {
  style?: string;
  characterId?: string;
}

export interface ImagePlanningPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  locked?: boolean;
  onResult: (article: Article, assets: ImageAsset[]) => void;
  planImages?: (expectedUpdatedAt: string, model?: string, options?: ImagePlanGuideOptions) => Promise<ImageMutationPayload>;
  updateAsset?: (
    assetId: string,
    input: ImageAssetPatch & { expectedUpdatedAt: string }
  ) => Promise<ImageMutationPayload>;
  deleteAsset?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  refreshPlaceholder?: (
    assetId: string,
    expectedUpdatedAt: string
  ) => Promise<ImageMutationPayload>;
  /** 真实图片生成服务；未提供（未配置）时不显示生成入口。 */
  generateImage?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  /** 配图规划的模型选择：默认走服务端 LLM_VISUAL_MODEL（快模型），可手动切换。 */
  llmEnabled?: boolean;
  availableModels?: string[];
}

const typeLabels: Record<ImageAsset["type"], string> = {
  cover: "封面图",
  concept: "概念图",
  process: "流程图",
  comparison: "对比图",
  knowledge_card: "知识卡片"
};

const statusLabels: Record<ImageAsset["status"], string> = {
  planned: "已规划",
  placeholder: "待生成",
  generating: "生成中",
  generated: "已生成",
  disabled: "已停用",
  failed: "生成失败"
};

const aspectRatios: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "cover", label: "封面 2.35:1" },
  { value: "landscape", label: "横图 3:2" },
  { value: "square", label: "方图 1:1" },
  { value: "portrait", label: "竖图 3:4" }
];

const STYLE_NONE = "__none__";
const STYLE_CUSTOM = "__custom__";
const CHARACTER_NONE = "__none__";
const CHARACTER_UPLOAD = "__upload__";

const stylePresets: Array<{ value: string; label: string }> = [
  { value: "简笔画", label: "简笔画（线条涂鸦）" },
  { value: "扁平插画", label: "扁平插画" },
  { value: "手绘水彩", label: "手绘水彩" },
  { value: "卡通贴纸", label: "卡通贴纸" },
  { value: "黑板板书", label: "黑板板书" },
  { value: "像素风", label: "像素风" },
  { value: "3D 可爱风", label: "3D 可爱风" }
];

interface ImageDraft {
  prompt: string;
  altText: string;
  assetUpdatedAt: string;
}

function draftFor(asset: ImageAsset, drafts: Record<string, ImageDraft>) {
  const draft = drafts[asset.id];
  return draft?.assetUpdatedAt === asset.updatedAt
    ? draft
    : { prompt: asset.prompt, altText: asset.altText, assetUpdatedAt: asset.updatedAt };
}

function sourceFor(asset: ImageAsset) {
  return asset.publicUrl ?? asset.placeholderUrl ?? `/api/image-assets/${asset.id}/content`;
}

function truncate(value: string) {
  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ImagePlanningPanel({
  article,
  assets,
  readOnly = false,
  locked = false,
  onResult,
  planImages,
  updateAsset,
  deleteAsset,
  refreshPlaceholder,
  generateImage,
  llmEnabled = false,
  availableModels = []
}: ImagePlanningPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ImageDraft>>({});
  const [planModel, setPlanModel] = useState("");
  const anchors = article.blocks.filter((block) => block.type !== "image");

  // 绘制风格：预设下拉 + 自定义文本，最终以字符串参与规划。
  const [styleOption, setStyleOption] = useState(STYLE_NONE);
  const [styleInput, setStyleInput] = useState("");
  const effectiveStyle =
    styleOption === STYLE_CUSTOM ? styleInput.trim() : styleOption === STYLE_NONE ? "" : styleOption;

  // 参考形象库：全局共享，选择后随规划请求提交。
  const [characters, setCharacters] = useState<ReferenceCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPersona, setUploadPersona] = useState("");
  const [uploading, setUploading] = useState(false);
  const [characterError, setCharacterError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsLoadedRef = useRef(false);
  const selectedCharacter = characters.find((item) => item.id === characterId) ?? null;

  // 形象库与本文配图偏好：挂载时各拉一次，失败静默降级（不影响手动上传/规划）。
  useEffect(() => {
    let cancelled = false;
    settingsLoadedRef.current = false;
    fetch("/api/characters")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { characters?: ReferenceCharacter[] }) => {
        if (!cancelled) setCharacters(Array.isArray(data.characters) ? data.characters : []);
      })
      .catch(() => undefined);
    fetch(`/api/articles/${article.id}/image-settings`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { style?: unknown; characterId?: unknown }) => {
        if (cancelled) return;
        const style = typeof data.style === "string" ? data.style : "";
        if (stylePresets.some((preset) => preset.value === style)) {
          setStyleOption(style);
        } else if (style) {
          setStyleOption(STYLE_CUSTOM);
          setStyleInput(style);
        }
        if (typeof data.characterId === "string") setCharacterId(data.characterId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) settingsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [article.id]);

  // 偏好变化即时持久化，下次进入配图步骤自动回显。
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    const controller = new AbortController();
    fetch(`/api/articles/${article.id}/image-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ style: effectiveStyle, characterId: characterId || null }),
      signal: controller.signal
    }).catch(() => undefined);
    return () => controller.abort();
  }, [article.id, characterId, effectiveStyle]);

  // 选中形象的编辑草稿由 CharacterEditor 组件自持（key 重挂载即重置）。

  function updateDraft(asset: ImageAsset, field: "prompt" | "altText", value: string) {
    setDrafts((current) => ({
      ...current,
      [asset.id]: { ...draftFor(asset, current), [field]: value }
    }));
  }

  async function run(operation: () => Promise<ImageMutationPayload>) {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      onResult(result.article, result.assets);
    } catch (requestError) {
      setError(readableError(requestError, "配图操作失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  function patchAsset(assetId: string, patch: ImageAssetPatch) {
    if (locked || !updateAsset) return;
    void run(() => updateAsset(assetId, { ...patch, expectedUpdatedAt: article.updatedAt }));
  }

  function planGuideOptions(): ImagePlanGuideOptions {
    return {
      ...(effectiveStyle ? { style: effectiveStyle } : {}),
      ...(characterId ? { characterId } : {})
    };
  }

  function analyzePlan() {
    if (!planImages) return;
    const options = planGuideOptions();
    const model = planModel || undefined;
    void run(() =>
      options.style || options.characterId
        ? planImages(article.updatedAt, model, options)
        : planImages(article.updatedAt, model)
    );
  }

  function reanalyzePlan() {
    if (!planImages) return;
    const confirmed = window.confirm(
      "重新分析会替换当前配图计划（包括已编辑的提示词），确定继续？"
    );
    if (confirmed) analyzePlan();
  }

  async function handleUploadCharacter() {
    if (!uploadFile || !uploadName.trim()) {
      setCharacterError("请选择参考图并填写形象名称");
      return;
    }
    setUploading(true);
    setCharacterError("");
    try {
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("name", uploadName.trim());
      form.set("persona", uploadPersona.trim());
      const response = await fetch("/api/characters", { method: "POST", body: form });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "参考图上传失败，请稍后重试");
      }
      const created = data.character;
      setCharacters((current) => [...current, created]);
      setCharacterId(created.id);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadName("");
      setUploadPersona("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setCharacterError(readableError(uploadError, "参考图上传失败，请稍后重试"));
    } finally {
      setUploading(false);
    }
  }

  function characterSelectValue() {
    if (showUploadForm) return CHARACTER_UPLOAD;
    return characterId && characters.some((item) => item.id === characterId)
      ? characterId
      : CHARACTER_NONE;
  }

  function onCharacterSelectChange(value: string) {
    setCharacterError("");
    if (value === CHARACTER_UPLOAD) {
      setShowUploadForm(true);
      return;
    }
    setShowUploadForm(false);
    setCharacterId(value === CHARACTER_NONE ? "" : value);
  }

  const guide = (
    <div className="plan-guide">
      <div className="plan-guide-row">
        <label className="plan-guide-field">
          <span>绘制风格（可选）</span>
          <select
            aria-label="绘制风格"
            value={styleOption}
            disabled={locked || busy}
            onChange={(event) => setStyleOption(event.target.value)}
          >
            <option value={STYLE_NONE}>不指定风格</option>
            {stylePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value={STYLE_CUSTOM}>自定义…</option>
          </select>
        </label>
        {styleOption === STYLE_CUSTOM ? (
          <label className="plan-guide-field">
            <span>自定义风格描述</span>
            <input
              aria-label="自定义风格描述"
              value={styleInput}
              placeholder="例如：蜡笔手绘风，暖色调"
              disabled={locked || busy}
              onChange={(event) => setStyleInput(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="plan-guide-row">
        <label className="plan-guide-field">
          <span>参考形象（可选）</span>
          <select
            aria-label="参考形象"
            value={characterSelectValue()}
            disabled={locked || busy}
            onChange={(event) => onCharacterSelectChange(event.target.value)}
          >
            <option value={CHARACTER_NONE}>不使用参考形象</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>{character.name}</option>
            ))}
            <option value={CHARACTER_UPLOAD}>上传新形象…</option>
          </select>
        </label>
      </div>

      {showUploadForm ? (
        <div className="plan-upload-form">
          <label className="plan-guide-field">
            <span>参考图（PNG / JPG / WebP / GIF，≤5MB）</span>
            <input
              aria-label="参考图文件"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={locked || uploading}
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="plan-guide-row">
            <label className="plan-guide-field">
              <span>形象名称</span>
              <input
                aria-label="形象名称"
                value={uploadName}
                placeholder="例如：蘑菇老师"
                maxLength={40}
                disabled={locked || uploading}
                onChange={(event) => setUploadName(event.target.value)}
              />
            </label>
            <label className="plan-guide-field">
              <span>身份设定（可选）</span>
              <input
                aria-label="身份设定"
                value={uploadPersona}
                placeholder="例如：自媒体科普老师"
                maxLength={200}
                disabled={locked || uploading}
                onChange={(event) => setUploadPersona(event.target.value)}
              />
            </label>
          </div>
          <div className="plan-upload-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={uploading}
              onClick={() => {
                setShowUploadForm(false);
                setUploadFile(null);
                setUploadName("");
                setUploadPersona("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              取消
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={uploading || locked}
              onClick={() => void handleUploadCharacter()}
            >
              <Upload size={15} aria-hidden="true" />
              {uploading ? "上传中..." : "上传并保存到形象库"}
            </button>
          </div>
        </div>
      ) : null}

      {selectedCharacter && !showUploadForm ? (
        <CharacterEditor
          key={selectedCharacter.id}
          character={selectedCharacter}
          locked={locked}
          llmEnabled={llmEnabled}
          availableModels={availableModels}
          onUpdated={(updated) =>
            setCharacters((current) => current.map((item) => (item.id === updated.id ? updated : item)))
          }
          onDeleted={(id) => {
            setCharacters((current) => current.filter((item) => item.id !== id));
            setCharacterId("");
          }}
          onError={setCharacterError}
        />
      ) : null}

      {characterError ? <p className="image-plan-error" role="alert">{characterError}</p> : null}

      <div className="plan-guide-actions">
        <ModelSelect
          enabled={llmEnabled}
          availableModels={availableModels}
          value={planModel}
          id="image-plan-model"
          label="规划模型"
          disabled={locked || busy}
          includeDefaultOption
          defaultOptionLabel="默认（轻量快模型）"
          onChange={setPlanModel}
        />
        <button
          className="button button-primary generation-button"
          type="button"
          disabled={locked || busy || !planImages}
          onClick={assets.length ? reanalyzePlan : analyzePlan}
        >
          <ImagePlus size={16} aria-hidden="true" />
          {busy ? "正在分析..." : assets.length ? "按当前风格与形象重新分析" : "分析配图需求"}
        </button>
      </div>
    </div>
  );

  if (!assets.length) {
    if (!anchors.length) return null;
    return (
      <div className="image-planning-panel">
        {locked ? (
          <p className="image-plan-lock-notice" role="status">
            正在保存文章，保存完成后可操作配图
          </p>
        ) : null}
        {error ? <p className="image-plan-error" role="alert">{error}</p> : null}
        {!readOnly ? guide : null}
      </div>
    );
  }

  return (
    <section className="image-planning-panel" aria-label="配图工作区">
      {locked ? (
        <p className="image-plan-lock-notice" role="status">
          正在保存文章，保存完成后可操作配图
        </p>
      ) : null}
      {error ? <p className="image-plan-error" role="alert">{error}</p> : null}
      {!readOnly ? guide : null}
      <ol className="image-plan-list">
        {assets.map((asset, index) => {
          const draft = draftFor(asset, drafts);
          const anchor = anchors.find((block) => block.id === asset.anchorBlockId);
          return (
            <li className="image-plan-item" key={asset.id}>
              {/* Placeholder URLs are dynamic internal API routes. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="image-plan-thumbnail"
                src={sourceFor(asset)}
                alt={asset.altText || "文章配图"}
                loading="lazy"
              />
              <div className="image-plan-summary">
                <div className="image-plan-meta">
                  <strong>{typeLabels[asset.type]}</strong>
                  <span className={`image-status image-status-${asset.status}`}>
                    {statusLabels[asset.status]}
                  </span>
                </div>
                {asset.type === "cover" ? null : (
                  <p className="image-plan-anchor">
                    <MapPin size={13} aria-hidden="true" />
                    {anchor ? truncate(anchor.content) : "待重新定位"}
                  </p>
                )}
                <p className="image-plan-purpose">{asset.purpose}</p>
              </div>

              {!readOnly ? (
                <div className="image-plan-fields">
                  <label>
                    <span>提示词</span>
                    <textarea
                      aria-label={`配图提示词 ${index + 1}`}
                      value={draft.prompt}
                      rows={3}
                      disabled={locked || busy}
                      onChange={(event) => updateDraft(asset, "prompt", event.target.value)}
                      onBlur={(event) => {
                        const prompt = event.target.value.trim();
                        if (prompt && prompt !== asset.prompt) patchAsset(asset.id, { prompt });
                      }}
                    />
                  </label>
                  <label>
                    <span>替代文本</span>
                    <input
                      aria-label={`配图替代文本 ${index + 1}`}
                      value={draft.altText}
                      disabled={locked || busy}
                      onChange={(event) => updateDraft(asset, "altText", event.target.value)}
                      onBlur={(event) => {
                        const altText = event.target.value.trim();
                        if (altText && altText !== asset.altText) patchAsset(asset.id, { altText });
                      }}
                    />
                  </label>
                  <label>
                    <span>比例</span>
                    <select
                      aria-label={`配图比例 ${index + 1}`}
                      value={asset.aspectRatio}
                      disabled={locked || busy}
                      onChange={(event) =>
                        patchAsset(asset.id, { aspectRatio: event.target.value as ImageAspectRatio })
                      }
                    >
                      {aspectRatios.map((ratio) => (
                        <option key={ratio.value} value={ratio.value}>{ratio.label}</option>
                      ))}
                    </select>
                  </label>
                  {asset.type !== "cover" ? (
                    <label>
                      <span>插入位置</span>
                      <select
                        aria-label={`配图锚点 ${index + 1}`}
                        value={asset.anchorBlockId ?? ""}
                        disabled={locked || busy}
                        onChange={(event) => patchAsset(asset.id, { anchorBlockId: event.target.value })}
                      >
                        {anchors.map((block: ContentBlock) => (
                          <option key={block.id} value={block.id}>{truncate(block.content)}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="image-plan-actions">
                    <label className="image-enabled-toggle">
                      <input
                        aria-label={`启用配图 ${index + 1}`}
                        type="checkbox"
                        checked={asset.status !== "disabled"}
                        disabled={locked || busy}
                        onChange={(event) => patchAsset(asset.id, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    {generateImage ? (
                      <button
                        className="icon-button image-generate-button"
                        type="button"
                        title={
                          asset.status === "generated"
                            ? `重新生成配图 ${index + 1}`
                            : `生成配图 ${index + 1}`
                        }
                        aria-label={
                          asset.status === "generated"
                            ? `重新生成配图 ${index + 1}`
                            : `生成配图 ${index + 1}`
                        }
                        disabled={locked || busy || asset.status === "disabled" || asset.status === "generating"}
                        onClick={() =>
                          void run(() => generateImage(asset.id, article.updatedAt))
                        }
                      >
                        <Sparkles size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      type="button"
                      title={`重建占位图 ${index + 1}`}
                      aria-label={`重建占位图 ${index + 1}`}
                      disabled={locked || busy || asset.status === "disabled" || !refreshPlaceholder}
                      onClick={() => refreshPlaceholder && void run(() => refreshPlaceholder(asset.id, article.updatedAt))}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={`删除配图 ${index + 1}`}
                      aria-label={`删除配图 ${index + 1}`}
                      disabled={locked || busy || !deleteAsset}
                      onClick={() => deleteAsset && void run(() => deleteAsset(asset.id, article.updatedAt))}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface CharacterEditorProps {
  character: ReferenceCharacter;
  locked: boolean;
  llmEnabled: boolean;
  availableModels: string[];
  onUpdated: (character: ReferenceCharacter) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}

/** 单个参考形象的查看/编辑卡：以 key 重挂载方式切换目标形象，编辑草稿随挂载初始化。 */
function CharacterEditor({
  character,
  locked,
  llmEnabled,
  availableModels,
  onUpdated,
  onDeleted,
  onError
}: CharacterEditorProps) {
  const [persona, setPersona] = useState(character.persona);
  const [description, setDescription] = useState(character.description);
  const [describeModel, setDescribeModel] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: persona.trim(), description: description.trim() })
      });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "形象保存失败，请稍后重试");
      }
      onUpdated(data.character);
    } catch (saveError) {
      onError(readableError(saveError, "形象保存失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function describe() {
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(describeModel ? { model: describeModel } : {})
      });
      const data = (await response.json()) as { character?: ReferenceCharacter; error?: string };
      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "形象提取失败，请稍后重试");
      }
      const updated = data.character;
      onUpdated(updated);
      setDescription(updated.description);
    } catch (describeError) {
      onError(readableError(describeError, "形象提取失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm(`删除参考形象「${character.name}」？已生成的配图不受影响。`)) return;
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "形象删除失败，请稍后重试");
      }
      onDeleted(character.id);
    } catch (deleteError) {
      onError(readableError(deleteError, "形象删除失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="plan-character-card">
      {/* 内部 API 路由图片。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="plan-character-thumb"
        src={character.publicUrl}
        alt={`参考形象 ${character.name}`}
      />
      <div className="plan-character-fields">
        <p className="plan-character-name">{character.name}</p>
        <label className="plan-guide-field">
          <span>身份设定</span>
          <input
            aria-label="编辑身份设定"
            value={persona}
            maxLength={200}
            disabled={locked || pending}
            onChange={(event) => setPersona(event.target.value)}
          />
        </label>
        <label className="plan-guide-field">
          <span>形象描述（用于绘图提示词复现形象）</span>
          <textarea
            aria-label="形象描述"
            value={description}
            rows={3}
            placeholder="上传后可点击「AI 提取形象」自动生成，也可手动修改"
            disabled={locked || pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="plan-character-actions">
          <ModelSelect
            enabled={llmEnabled}
            availableModels={availableModels}
            value={describeModel}
            id="character-describe-model"
            label="视觉模型"
            disabled={locked || pending}
            includeDefaultOption
            defaultOptionLabel="默认（服务端配置）"
            onChange={setDescribeModel}
          />
          <button
            className="button button-secondary"
            type="button"
            disabled={locked || pending || !llmEnabled}
            onClick={() => void describe()}
          >
            <Wand2 size={15} aria-hidden="true" />
            {pending ? "处理中..." : "AI 提取形象"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={locked || pending}
            onClick={() => void save()}
          >
            保存修改
          </button>
          <button
            className="button button-secondary plan-character-delete"
            type="button"
            disabled={locked || pending}
            onClick={() => void remove()}
          >
            <Trash2 size={15} aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
