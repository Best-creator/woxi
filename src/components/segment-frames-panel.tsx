"use client";

import { History, Images, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STORYBOARD_ROUTE_LABELS, type Article } from "@/features/articles/domain";
import type { ImageAsset, ImageLibraryItem } from "@/features/images/domain";
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

export interface SegmentFramesPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：生成要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 生成会推进文章版本，回传整份文章与资产交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  /** 单帧生成（占位/失败重试/已生成重生成均走它）；未提供（无生图服务）时隐藏按钮。 */
  generateImage?: (assetId: string, expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
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
  selectGeneration
}: SegmentFramesPanelProps) {
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [generations, setGenerations] = useState<ImageLibraryItem[]>([]);
  const [versionsAssetId, setVersionsAssetId] = useState<string | null>(null);

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
      onResult(await action(asset.updatedAt));
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
      onResult(await generateBatch({ expectedUpdatedAt: article.updatedAt }));
      await refreshGenerations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBatchBusy(false);
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
                            void runAsset(asset.id, (token) => generateImage(asset.id, token))
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
