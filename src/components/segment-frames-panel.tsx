"use client";

import { History, Images, Loader2, MessageSquarePlus, Pencil, RefreshCw, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STORYBOARD_ROUTE_LABELS, type Article } from "@/features/articles/domain";
import {
  SPEECH_LINE_KINDS,
  SPEECH_LINE_KIND_LABELS,
  type ImageAsset,
  type ImageLibraryItem,
  type SpeechLineKind
} from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
import type { ImageMutationPayload } from "./image-planning-panel";

/**
 * 第四步「分镜配图」的帧生成面板：直接消费第三步设计的 planning.storyboardSegments，
 * 按段分组展示帧卡片，逐帧生成 / 一键批量生成 / 轻量版本抽屉（看历史 + 选用）。
 *
 * 设计稿的帧在这里出图，出齐后由下方的分段拼接控制烘成段图——第四步不再提供
 * 「重新设计分镜」入口（视觉规划器会删掉/禁用第三步的帧，两套设计互相打架，
 * 服务端 planImages 也对分镜文章直接拒绝）。
 */

const statusLabels: Record<ImageAsset["status"], string> = {
  planned: "待生成",
  placeholder: "待生成",
  generating: "生成中",
  generated: "已生成",
  disabled: "已停用",
  failed: "生成失败"
};

function frameSrc(asset: ImageAsset) {
  if (asset.status === "generated") {
    // 生成成功：优先远程图；本地落盘图走 content 路由。URL 追加 updatedAt 破缓存，
    // 否则重新生成后 src 不变，浏览器继续显示旧图。
    return (
      asset.publicUrl ??
      `/api/image-assets/${asset.id}/content?v=${encodeURIComponent(asset.updatedAt)}`
    );
  }
  return asset.publicUrl ?? asset.placeholderUrl ?? `/api/image-assets/${asset.id}/content`;
}

function isPendingFrame(asset: ImageAsset) {
  return asset.status !== "disabled" && asset.status !== "generated" && asset.status !== "generating";
}

/** 第四步帧生成的可选偏好：画风（风格库条目引用或空）与参考形象 id 或空。 */
export interface PlanSettingsChoice {
  style: string;
  characterId: string | null;
}

interface PlanSettingsOption {
  value: string;
  label: string;
}

export interface SegmentFramesPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：生成要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 生成会推进文章版本，回传整份文章与资产交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  /** 单帧生成（占位/失败重试/已生成重生成均走它）；未提供（无生图服务）时隐藏按钮。
   *  第三个参数是本次使用的生图模型（跨站点可选），缺省用服务端默认模型。 */
  generateImage?: (
    assetId: string,
    expectedUpdatedAt: string,
    model?: string
  ) => Promise<ImageMutationPayload>;
  /** 一键生成全部待生成帧；未提供时隐藏入口。 */
  generateBatch?: (input: { expectedUpdatedAt: string; model?: string }) => Promise<ImageMutationPayload>;
  /** generating 卡住的解卡入口：取消并恢复占位图。 */
  refreshPlaceholder: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
  /** 在帧的历史版本之间切换（轻量版本控制）；未提供时只看不能选。 */
  selectGeneration?: (
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ) => Promise<ImageMutationPayload>;
  /** 修改帧信息（当前用于图注 altText 与台词 speechLine）；未提供时两者只读展示。 */
  updateAsset?: (
    assetId: string,
    input: ImageAssetPatch & { expectedUpdatedAt: string }
  ) => Promise<ImageMutationPayload>;
  /** 已配置生图服务时为 true：显示「绘制风格 + 参考形象」配置行（保存到 image-settings）。 */
  planSettingsEnabled?: boolean;
}

export function SegmentFramesPanel({
  article,
  assets,
  readOnly = false,
  disabled = false,
  onResult,
  generateImage,
  generateBatch,
  refreshPlaceholder,
  selectGeneration,
  updateAsset,
  planSettingsEnabled = false
}: SegmentFramesPanelProps) {
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [generations, setGenerations] = useState<ImageLibraryItem[]>([]);
  const [versionsAssetId, setVersionsAssetId] = useState<string | null>(null);
  const [altEdit, setAltEdit] = useState<{ assetId: string; value: string } | null>(null);
  const [speechEdit, setSpeechEdit] = useState<{
    assetId: string;
    kind: SpeechLineKind;
    value: string;
  } | null>(null);
  // 生成偏好：settingsSaved 是已保存基线（用于 dirty 判断），settingsDraft 是表单草稿。
  const [settingsSaved, setSettingsSaved] = useState<PlanSettingsChoice | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PlanSettingsChoice | null>(null);
  const [styleOptions, setStyleOptions] = useState<PlanSettingsOption[]>([]);
  const [characterOptions, setCharacterOptions] = useState<PlanSettingsOption[]>([]);
  const [settingsBusy, setSettingsBusy] = useState(false);
  // 生图模型：从 /api/image-models 拉聚合目录（跨站点，带归属）；空值 = 服务端默认模型。
  const [imageModels, setImageModels] = useState<Array<{ id: string; provider: string }>>([]);
  const [defaultImageModel, setDefaultImageModel] = useState<string | null>(null);
  const [imageModel, setImageModel] = useState("");
  // 生成能力是个稳定布尔量：generateImage 是父组件每次渲染新建的函数，
  // 直接进依赖数组会让下面的拉取 effect 每次渲染都重跑。
  const generationAvailable = Boolean(generateImage);
  const multiProvider = useMemo(
    () => new Set(imageModels.map((item) => item.provider)).size > 1,
    [imageModels]
  );

  const segments = useMemo(
    () => [...(article.planning.storyboardSegments ?? [])].sort((left, right) => left.order - right.order),
    [article.planning.storyboardSegments]
  );
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const pendingFrames = useMemo(
    () =>
      segments
        .flatMap((segment) => segment.frameAssetIds)
        .map((id) => assetById.get(id))
        .filter((asset): asset is ImageAsset => Boolean(asset) && isPendingFrame(asset!)),
    [segments, assetById]
  );
  const versionsByAsset = useMemo(() => {
    const byAsset = new Map<string, ImageLibraryItem[]>();
    for (const generation of generations) {
      const bucket = byAsset.get(generation.assetId) ?? [];
      bucket.push(generation);
      byAsset.set(generation.assetId, bucket);
    }
    return byAsset;
  }, [generations]);

  const refreshGenerations = useCallback(async () => {
    // 素材库接口失败时静默降级：版本抽屉显示为空，不影响生成/拼接本身。
    try {
      const response = await fetch(`/api/articles/${article.id}/image-generations`);
      if (!response.ok) return;
      const data = (await response.json()) as { generations?: ImageLibraryItem[] };
      if (Array.isArray(data.generations)) setGenerations(data.generations);
    } catch {
      // 离线/测试环境：保持现状。
    }
  }, [article.id]);

  useEffect(() => {
    // 挂载时从素材库接口同步一次帧版本历史：外部系统拉取，setState 只在
    // await 之后的异步延续里发生，不是同步级联渲染（同 article-workspace 的做法）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshGenerations();
  }, [refreshGenerations]);

  const loadPlanSettings = useCallback(async () => {
    // 偏好 + 画风库 + 参考形象三路并行；任一失败配置行保持隐藏（静默降级，同 refreshGenerations）。
    try {
      const [settingsResponse, stylesResponse, charactersResponse] = await Promise.all([
        fetch(`/api/articles/${article.id}/image-settings`),
        fetch("/api/style-library"),
        fetch("/api/characters")
      ]);
      if (!settingsResponse.ok || !stylesResponse.ok || !charactersResponse.ok) return;
      const settings = (await settingsResponse.json()) as Partial<PlanSettingsChoice>;
      const stylesPayload = (await stylesResponse.json()) as {
        styles?: Array<{ id: string; name: string }>;
      };
      const charactersPayload = (await charactersResponse.json()) as {
        characters?: Array<{ id: string; name: string }>;
      };
      const initial: PlanSettingsChoice = {
        style: settings.style ?? "",
        characterId: settings.characterId ?? null
      };
      setSettingsSaved(initial);
      setSettingsDraft(initial);
      setStyleOptions(
        (stylesPayload.styles ?? []).map((style) => ({
          value: `library:${style.id}`,
          label: style.name
        }))
      );
      setCharacterOptions(
        (charactersPayload.characters ?? []).map((character) => ({
          value: character.id,
          label: character.name
        }))
      );
    } catch {
      // 离线/测试环境：配置行保持隐藏，不影响生成主链路。
    }
  }, [article.id]);

  useEffect(() => {
    if (!planSettingsEnabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlanSettings();
  }, [planSettingsEnabled, loadPlanSettings]);

  useEffect(() => {
    // 生图模型目录：有生图能力才拉；接口失败静默降级（不显示下拉，按服务端默认模型生成）。
    if (!generationAvailable) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/image-models");
        if (!response.ok) return;
        const data = (await response.json()) as {
          models?: Array<{ id: string; provider: string }>;
          defaultModel?: string | null;
        };
        if (cancelled) return;
        setImageModels(Array.isArray(data.models) ? data.models : []);
        setDefaultImageModel(data.defaultModel ?? null);
      } catch {
        // 离线/测试环境：保持空目录。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generationAvailable]);

  const settingsDirty = useMemo(() => {
    if (!settingsDraft || !settingsSaved) return false;
    return (
      settingsDraft.style !== settingsSaved.style ||
      (settingsDraft.characterId ?? "") !== (settingsSaved.characterId ?? "")
    );
  }, [settingsDraft, settingsSaved]);

  async function savePlanSettings() {
    if (!settingsDraft) return;
    setSettingsBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/articles/${article.id}/image-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: settingsDraft.style, characterId: settingsDraft.characterId })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "生成偏好保存失败，请稍后重试");
      }
      setSettingsSaved({ ...settingsDraft });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setSettingsBusy(false);
    }
  }

  const locked = readOnly || disabled || batchBusy || busyAssetId !== null;
  const generationEnabled = Boolean(generateImage);

  async function runAsset(
    assetId: string,
    action: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>
  ) {
    const asset = assetById.get(assetId);
    if (!asset) return;
    setBusyAssetId(assetId);
    setError("");
    try {
      // 乐观锁是文章级的：服务端校验 article.updatedAt。帧的 updated_at 有自己的
      // 时间线（生成成功/失败只推进被写的帧），与文章令牌会差几毫秒——拿它当令牌
      // 必撞 409「文章已在其他位置更新」。旧版规划面板一直传的就是文章令牌。
      onResult(await action(article.updatedAt));
      await refreshGenerations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusyAssetId(null);
    }
  }

  async function runBatch() {
    if (!generateBatch) return;
    setBatchBusy(true);
    setError("");
    try {
      onResult(
        await generateBatch({
          expectedUpdatedAt: article.updatedAt,
          ...(imageModel ? { model: imageModel } : {})
        })
      );
      await refreshGenerations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBatchBusy(false);
    }
  }

  async function saveAltText() {
    if (!altEdit || !updateAsset) return;
    const altText = altEdit.value.trim();
    // 图注空了就没有可读性可言（导出 PDF 与公众号的图注都来自它），不提交。
    if (!altText) return;
    setBusyAssetId(altEdit.assetId);
    setError("");
    try {
      onResult(
        await updateAsset(altEdit.assetId, { altText, expectedUpdatedAt: article.updatedAt })
      );
      setAltEdit(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusyAssetId(null);
    }
  }

  async function saveSpeechLine() {
    if (!speechEdit || !updateAsset) return;
    const text = speechEdit.value.trim();
    setBusyAssetId(speechEdit.assetId);
    setError("");
    try {
      // 与图注不同：清空后保存是合法操作 = 删除台词条（PATCH speechLine: null）。
      onResult(
        await updateAsset(speechEdit.assetId, {
          speechLine: text ? { kind: speechEdit.kind, text } : null,
          expectedUpdatedAt: article.updatedAt
        })
      );
      setSpeechEdit(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusyAssetId(null);
    }
  }

  if (!segments.length) return null;

  return (
    <section className="segment-frames-panel" aria-label="分镜配图">
      <div className="comic-strip-head">
        <strong>
          <Images size={16} aria-hidden="true" />
          分镜配图
        </strong>
        <p>
          第三步设计的 {segments.length} 段分镜共{" "}
          {segments.reduce((total, segment) => total + segment.frameAssetIds.length, 0)} 帧，
          出齐后即可在下方拼接段图。
        </p>
      </div>

      {planSettingsEnabled && settingsDraft ? (
        <form
          className="segment-frames-settings"
          aria-label="生成偏好"
          onSubmit={(event) => {
            event.preventDefault();
            void savePlanSettings();
          }}
        >
          <label className="segment-frames-settings-field">
            <span>绘制风格</span>
            <select
              value={settingsDraft.style}
              disabled={locked || settingsBusy}
              aria-label="绘制风格"
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, style: event.target.value } : current
                )
              }
            >
              <option value="">跟随设计稿（不额外注入）</option>
              {styleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="segment-frames-settings-field">
            <span>参考形象</span>
            <select
              value={settingsDraft.characterId ?? ""}
              disabled={locked || settingsBusy}
              aria-label="参考形象"
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, characterId: event.target.value || null } : current
                )
              }
            >
              <option value="">不使用</option>
              {characterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-secondary segment-frames-settings-save"
            type="submit"
            disabled={locked || settingsBusy || !settingsDirty}
          >
            {settingsBusy ? "保存中..." : "保存偏好"}
          </button>
          <p className="segment-frames-settings-note">
            对之后新发起的帧生成生效：画风注入每帧提示词；参考形象同时附上形象图做图生图，保持角色一致。
          </p>
        </form>
      ) : null}

      {generationAvailable && imageModels.length > 0 ? (
        <div className="segment-frames-model">
          <label className="segment-frames-model-field">
            <span>生图模型</span>
            <select
              aria-label="生图模型"
              value={imageModel}
              disabled={locked}
              title="生成帧使用的模型；可跨站点选择，生成时按模型归属路由到对应站点，报错时可换模型重试"
              onChange={(event) => setImageModel(event.target.value)}
            >
              <option value="">
                {defaultImageModel ? `默认模型（${defaultImageModel}）` : "默认模型"}
              </option>
              {imageModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {multiProvider ? `${item.id}（${item.provider}）` : item.id}
                </option>
              ))}
            </select>
          </label>
          <p className="segment-frames-model-note">
            对之后发起的生成生效：单帧与一键批量都用这个模型。
          </p>
        </div>
      ) : null}

      {generateBatch && pendingFrames.length ? (
        <div className="segment-frames-batch">
          <button
            className="button button-primary"
            type="button"
            disabled={locked}
            onClick={() => void runBatch()}
          >
            {batchBusy ? (
              <Loader2 size={16} className="comic-strip-spin" aria-hidden="true" />
            ) : (
              <Wand2 size={16} aria-hidden="true" />
            )}
            {batchBusy ? "正在批量生成..." : `一键生成全部待生成帧（${pendingFrames.length}）`}
          </button>
        </div>
      ) : null}

      <ol className="segment-frames-list">
        {segments.map((segment, segmentIndex) => {
          const frames = segment.frameAssetIds
            .map((id) => assetById.get(id))
            .filter((asset): asset is ImageAsset => Boolean(asset));
          return (
            <li key={segment.id} className="segment-frames-item">
              <div className="segment-frames-item-head">
                <strong>
                  段 {segmentIndex + 1} · {segment.title}
                </strong>
                <span className="segment-frames-route">
                  {STORYBOARD_ROUTE_LABELS[segment.route]} · {segment.frameAssetIds.length} 帧
                </span>
              </div>
              {frames.length ? (
                <ul className="segment-frames-cards">
                  {frames.map((asset, frameIndex) => (
                    <li key={asset.id} className="segment-frame-card">
                      {/* 占位图走内部 API 路由，动态地址，next/image 不适用。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-plan-thumbnail"
                        src={frameSrc(asset)}
                        alt={asset.altText || `第 ${segmentIndex + 1} 段第 ${frameIndex + 1} 帧`}
                        loading="lazy"
                      />
                      <div className="image-plan-meta">
                        <strong>帧 {frameIndex + 1}</strong>
                        <span className={`image-status image-status-${asset.status}`}>
                          {statusLabels[asset.status]}
                        </span>
                      </div>
                      {altEdit?.assetId === asset.id ? (
                        <form
                          className="segment-frame-alt-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveAltText();
                          }}
                        >
                          <input
                            className="segment-frame-alt-input"
                            value={altEdit.value}
                            maxLength={240}
                            aria-label={`第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 图注`}
                            onChange={(event) =>
                              setAltEdit((current) =>
                                current && current.assetId === asset.id
                                  ? { ...current, value: event.target.value }
                                  : current
                              )
                            }
                          />
                          <button
                            className="button button-secondary segment-frame-alt-save"
                            type="submit"
                            disabled={locked || !altEdit.value.trim()}
                          >
                            保存
                          </button>
                          <button
                            className="button button-secondary segment-frame-alt-cancel"
                            type="button"
                            disabled={busyAssetId === asset.id}
                            onClick={() => setAltEdit(null)}
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <div className="segment-frame-alt">
                          <span className="segment-frame-alt-text" title={asset.altText}>
                            {asset.altText}
                          </span>
                          {!readOnly && updateAsset && asset.status !== "generating" ? (
                            <button
                              className="icon-button segment-frame-alt-button"
                              type="button"
                              title="编辑图注"
                              aria-label={`编辑第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 图注`}
                              disabled={locked}
                              onClick={() => setAltEdit({ assetId: asset.id, value: asset.altText })}
                            >
                              <Pencil size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      )}
                      {speechEdit?.assetId === asset.id ? (
                        <form
                          className="segment-frame-speech-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveSpeechLine();
                          }}
                        >
                          <select
                            className="segment-frame-speech-kind-select"
                            value={speechEdit.kind}
                            aria-label={`第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 台词类型`}
                            onChange={(event) =>
                              setSpeechEdit((current) =>
                                current && current.assetId === asset.id
                                  ? { ...current, kind: event.target.value as SpeechLineKind }
                                  : current
                              )
                            }
                          >
                            {SPEECH_LINE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {SPEECH_LINE_KIND_LABELS[kind]}
                              </option>
                            ))}
                          </select>
                          <input
                            className="segment-frame-speech-input"
                            value={speechEdit.value}
                            maxLength={60}
                            placeholder="留空保存即删除台词条"
                            title="对白 ≤10 字、旁白 ≤25 字；留空后保存即删除台词条"
                            aria-label={`第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 台词`}
                            onChange={(event) =>
                              setSpeechEdit((current) =>
                                current && current.assetId === asset.id
                                  ? { ...current, value: event.target.value }
                                  : current
                              )
                            }
                          />
                          <button
                            className="button button-secondary segment-frame-speech-save"
                            type="submit"
                            disabled={locked}
                          >
                            保存
                          </button>
                          <button
                            className="button button-secondary segment-frame-speech-cancel"
                            type="button"
                            disabled={busyAssetId === asset.id}
                            onClick={() => setSpeechEdit(null)}
                          >
                            取消
                          </button>
                        </form>
                      ) : asset.speechLine ? (
                        <div className="segment-frame-speech">
                          <span
                            className={`segment-frame-speech-kind segment-frame-speech-kind-${asset.speechLine.kind}`}
                          >
                            {SPEECH_LINE_KIND_LABELS[asset.speechLine.kind]}
                          </span>
                          <span className="segment-frame-speech-text" title={asset.speechLine.text}>
                            {asset.speechLine.text}
                          </span>
                          {!readOnly && updateAsset && asset.status !== "generating" ? (
                            <button
                              className="icon-button segment-frame-speech-button"
                              type="button"
                              title="编辑台词"
                              aria-label={`编辑第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 台词`}
                              disabled={locked}
                              onClick={() =>
                                setSpeechEdit({
                                  assetId: asset.id,
                                  kind: asset.speechLine!.kind,
                                  value: asset.speechLine!.text
                                })
                              }
                            >
                              <Pencil size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ) : !readOnly && updateAsset && asset.status !== "generating" ? (
                        <button
                          className="segment-frame-speech-add"
                          type="button"
                          aria-label={`给第 ${segmentIndex + 1} 段帧 ${frameIndex + 1} 加台词`}
                          disabled={locked}
                          onClick={() =>
                            setSpeechEdit({ assetId: asset.id, kind: "dialogue", value: "" })
                          }
                        >
                          <MessageSquarePlus size={12} aria-hidden="true" />
                          加台词条
                        </button>
                      ) : null}
                      {!readOnly && asset.status === "generating" ? (
                        <button
                          className="button button-secondary segment-frame-action"
                          type="button"
                          disabled={locked}
                          title="生成卡住了？点此取消并恢复占位图"
                          onClick={() =>
                            void runAsset(asset.id, (token) => refreshPlaceholder(asset.id, token))
                          }
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                          取消并恢复占位
                        </button>
                      ) : null}
                      {!readOnly && generateImage && asset.status !== "generating" && asset.status !== "disabled" ? (
                        <button
                          className="button button-secondary segment-frame-action"
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            void runAsset(asset.id, (token) =>
                              generateImage(asset.id, token, imageModel || undefined)
                            )
                          }
                        >
                          {busyAssetId === asset.id ? (
                            <Loader2 size={14} className="comic-strip-spin" aria-hidden="true" />
                          ) : (
                            <Wand2 size={14} aria-hidden="true" />
                          )}
                          {asset.status === "generated"
                            ? "重新生成"
                            : asset.status === "failed"
                              ? "重试生成"
                              : "生成"}
                        </button>
                      ) : null}
                      {versionsByAsset.get(asset.id)?.length ? (
                        <div className="segment-frame-versions">
                          <button
                            className="button button-secondary segment-frame-versions-toggle"
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              setVersionsAssetId((open) => (open === asset.id ? null : asset.id))
                            }
                          >
                            <History size={14} aria-hidden="true" />
                            已生成 {versionsByAsset.get(asset.id)!.length} 版
                          </button>
                          {versionsAssetId === asset.id ? (
                            <ul className="segment-frame-version-list">
                              {versionsByAsset.get(asset.id)!.map((generation, index, all) => (
                                <li key={generation.id} className="segment-frame-version-row">
                                  {/* 版本图走生成文件路由，动态地址，next/image 不适用。 */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    className="segment-frame-version-thumb"
                                    src={
                                      generation.publicUrl ??
                                      `/api/image-generations/${generation.id}/content`
                                    }
                                    alt={generation.prompt.slice(0, 40) || `第 ${all.length - index} 版`}
                                    loading="lazy"
                                  />
                                  <span className="segment-frame-version-label">
                                    第 {all.length - index} 版{generation.selected ? " · 当前" : ""}
                                  </span>
                                  {selectGeneration && !generation.selected ? (
                                    <button
                                      className="button button-secondary segment-frame-version-apply"
                                      type="button"
                                      disabled={locked}
                                      onClick={() =>
                                        void runAsset(asset.id, (token) =>
                                          selectGeneration(asset.id, generation.id, token)
                                        )
                                      }
                                    >
                                      选用此版
                                    </button>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="segment-frames-empty">
                  该段没有分镜帧，回第三步重新生成设计。
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!generationEnabled && pendingFrames.length ? (
        <p className="segment-frames-empty" role="status">
          未配置生图服务，帧保持占位图；配置后即可在这里生成。
        </p>
      ) : null}
      {error ? (
        <p className="comic-strip-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
