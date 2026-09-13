"use client";

import { ImagePlus, MapPin, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { ImageAsset, ImageAspectRatio } from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";

export interface ImageMutationPayload {
  article: Article;
  assets: ImageAsset[];
}

export interface ImagePlanningPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  locked?: boolean;
  onResult: (article: Article, assets: ImageAsset[]) => void;
  planImages?: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
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

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "配图操作失败，请稍后重试";
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
  generateImage
}: ImagePlanningPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ImageDraft>>({});
  const anchors = article.blocks.filter((block) => block.type !== "image");

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
      setError(readableError(requestError));
    } finally {
      setBusy(false);
    }
  }

  function patchAsset(assetId: string, patch: ImageAssetPatch) {
    if (locked || !updateAsset) return;
    void run(() => updateAsset(assetId, { ...patch, expectedUpdatedAt: article.updatedAt }));
  }

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
        {!readOnly ? (
          <button
            className="button button-primary generation-button"
            type="button"
            disabled={locked || busy || !planImages}
            onClick={() => planImages && void run(() => planImages(article.updatedAt))}
          >
            <ImagePlus size={16} aria-hidden="true" />
            {busy ? "正在分析..." : "分析配图需求"}
          </button>
        ) : null}
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
