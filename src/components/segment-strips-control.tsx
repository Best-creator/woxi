"use client";

import { Check, Images, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { STORYBOARD_ROUTE_LABELS, type Article } from "@/features/articles/domain";
import {
  STORYBOARD_FONT_OPTIONS,
  STORYBOARD_TEXT_SCALE_OPTIONS,
  resolveStoryboardFont,
  resolveStoryboardTextScale,
  type ImageAsset
} from "@/features/images/domain";
import { inspectSegmentStrips } from "@/features/images/inspect-segment-strips";
import type { ImageMutationPayload } from "./image-planning-panel";

// 与帧面板同源：段图走内部 API 路由，地址动态，next/image 不适用。
const contentUrl = (assetId: string) => `/api/image-assets/${assetId}/content`;

export interface SegmentStripsControlProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：拼接要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 拼接会重写正文，回传整份文章与资产交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  /** fontId / textScaleId 随拼接提交，由后端在校验全过之后持久化进 planning。 */
  composeSegmentStrips: (
    expectedUpdatedAt: string,
    fontId?: string,
    textScaleId?: string
  ) => Promise<ImageMutationPayload>;
  /** 取消段图复用旧长图的 DELETE：撤本篇全部 comic_strip 并放回正文。 */
  removeSegmentStrips: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
}

export function SegmentStripsControl({
  article,
  assets,
  readOnly = false,
  disabled = false,
  onResult,
  composeSegmentStrips,
  removeSegmentStrips
}: SegmentStripsControlProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{
    count: number;
    fontLabel: string;
    textScaleLabel: string;
  } | null>(null);
  // 段图实际像素：拼出来多高只有图片自己知道，加载后回填进清单。
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  // 字体选择本地暂存、随拼接提交持久化：未拼接前刷新或离开都不写库。
  const [fontId, setFontId] = useState(
    () => resolveStoryboardFont(article.planning.storyboardFontId).id
  );
  // 文字大小同理：段图在手机里只有约 1/3 宽度，字号烘进图里就是唯一变量。
  const [textScaleId, setTextScaleId] = useState(
    () => resolveStoryboardTextScale(article.planning.storyboardTextScaleId).id
  );

  // 与真正拼接共用同一套就绪判定（服务端 composeSegmentStrips 的校验同构）：
  // 按钮亮着就一定能拼成，不会点下去才说拼不了。逐段明细同源，界面不再自己数一遍。
  const readiness = useMemo(
    () => inspectSegmentStrips(article, assets),
    [article, assets]
  );
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const stripCount = useMemo(
    () => readiness.segments.filter((row) => row.stripAssetId).length,
    [readiness]
  );
  const stripsExist = stripCount > 0;
  const locked = readOnly || disabled || busy;
  const ready =
    readiness.totalSegments > 0 &&
    readiness.pendingFrames === 0 &&
    readiness.missingCopySegments === 0;

  const activeFont = resolveStoryboardFont(fontId);
  const activeTextScale = resolveStoryboardTextScale(textScaleId);
  // 段图是像素，字号烘进去就改不了，只能重拼。planning 里没有档位记录 = 这批段图出自旧渲染器
  // （正文 32px ≈ 手机 10px），正是作者反馈「看着很吃力」的那一版。
  const staleStrips = stripsExist && !article.planning.storyboardTextScaleId;

  // 状态徽章：一眼看出「这篇走到哪了」，不用读完整句提示。
  const badge = (() => {
    if (readiness.totalSegments === 0) return { tone: "empty", text: "待设计分镜" };
    if (stripsExist) return { tone: "done", text: `已拼接 ${stripCount} 段` };
    if (readiness.missingCopySegments > 0)
      return { tone: "warn", text: `${readiness.missingCopySegments} 段缺文案` };
    if (readiness.pendingFrames > 0)
      return { tone: "warn", text: `待补 ${readiness.pendingFrames} 帧` };
    return { tone: "ready", text: "可以拼接" };
  })();

  const hint = (() => {
    if (readiness.totalSegments === 0) {
      return "这篇正文还没有分镜设计，先回第三步生成或重新设计分镜。";
    }
    if (readiness.missingCopySegments > 0) {
      return `有 ${readiness.missingCopySegments} 段的成稿文案不在正文里，请回第三步重新设计。`;
    }
    if (readiness.pendingFrames > 0) {
      return `还有 ${readiness.pendingFrames} 帧分镜没生成图片，补齐后才能拼接。`;
    }
    if (staleStrips) {
      return `正文里现在是 ${stripCount} 张段图，但它们用的是旧字号（手机上只有约 10px）；重新拼接会按所选字号重出一遍。`;
    }
    if (stripsExist) {
      return `正文里现在是 ${stripCount} 张段图；重新拼接会按当前文案与所选字体、文字大小重出一遍。`;
    }
    // 四种路由都拼段图（text_only 拼纯文字图）：composableSegments === totalSegments，
    // 不再有「不拼图的纯文字段」。
    return `已就绪 ${readiness.readySegments} 段，将拼成 ${readiness.composableSegments} 张段图，文案会按所选字体与文字大小烘进图里。`;
  })();

  async function run(action: () => Promise<ImageMutationPayload>) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      // 拼接回执带 fontFamily：映射回选项名给作者看；取消段图没有回执，清掉旧回显。
      const fontLabel = result.fontFamily
        ? STORYBOARD_FONT_OPTIONS.find((option) => option.fontFamily === result.fontFamily)
          ?.label ?? "所选字体"
        : resolveStoryboardFont(article.planning.storyboardFontId).label;
      // 文字大小没有独立回执字段：以服务端落库后的 planning 为准，回显所见即所存。
      // 回执缺 article（测试桩或降级响应）时退回本次所选，不让摘要区连带崩掉。
      const textScaleLabel = resolveStoryboardTextScale(
        result.article?.planning?.storyboardTextScaleId ?? textScaleId
      ).label;
      setSummary(
        result.strips?.length
          ? { count: result.strips.length, fontLabel, textScaleLabel }
          : null
      );
      onResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="segment-strips-control" aria-label="分段拼接">
      <header className="segment-strips-head">
        <span className="segment-strips-icon" aria-hidden="true">
          <Images size={16} />
        </span>
        <div className="segment-strips-heading">
          <strong>分段拼接</strong>
          <p>每个分镜段各拼一张段图，文案烘进图里</p>
        </div>
        <span className={`segment-strips-badge segment-strips-badge-${badge.tone}`}>
          {badge.tone === "done" ? <Check size={12} aria-hidden="true" /> : null}
          {badge.text}
        </span>
      </header>

      <div className={`segment-strips-body${readiness.totalSegments > 0 ? " has-manifest" : ""}`}>
        <div className="segment-strips-controls">
          <div className="segment-font-field">
            <label htmlFor="segment-font">段图字体</label>
            <select
              id="segment-font"
              value={fontId}
              disabled={locked}
              onChange={(event) => setFontId(event.target.value)}
            >
              {STORYBOARD_FONT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* 字体烘进图里就是像素，选之前得先看见它长什么样。 */}
            <span className="segment-font-sample" style={{ fontFamily: activeFont.fontFamily }}>
              文案烘进图里的样子
            </span>
          </div>

          <div className="segment-font-field">
            <label htmlFor="segment-text-scale">文字大小</label>
            <select
              id="segment-text-scale"
              value={textScaleId}
              disabled={locked}
              onChange={(event) => setTextScaleId(event.target.value)}
            >
              {STORYBOARD_TEXT_SCALE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* 段图在手机里只有约 1/3 宽，字号是唯一变量：这里给的是手机上的实际观感。 */}
            <span className="segment-font-sample segment-scale-sample">
              {activeTextScale.hint}
            </span>
          </div>

          <div className="segment-strips-progress">
            <div className="segment-strips-progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${
                    readiness.totalSegments
                      ? Math.round((readiness.readySegments / readiness.totalSegments) * 100)
                      : 0
                  }%`
                }}
              />
            </div>
            <p className="comic-strip-hint" role="status">
              {hint}
            </p>
          </div>

          <div className="comic-strip-actions segment-strips-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={locked || !ready}
              onClick={() =>
                void run(() => composeSegmentStrips(article.updatedAt, fontId, textScaleId))
              }
            >
              {busy ? (
                <Loader2 size={16} className="comic-strip-spin" aria-hidden="true" />
              ) : (
                <Images size={16} aria-hidden="true" />
              )}
              {busy ? "正在拼接..." : stripsExist ? "重新拼接段图" : "拼接段图"}
            </button>
            {stripsExist ? (
              <button
                className="button segment-strips-cancel"
                type="button"
                disabled={locked}
                title="撤掉全部段图，把被替换的正文图文放回去"
                onClick={() => void run(() => removeSegmentStrips(article.updatedAt))}
              >
                <Trash2 size={15} aria-hidden="true" />
                取消段图
              </button>
            ) : null}
          </div>

          {summary ? (
            <p className="segment-strips-summary" role="status">
              {`已拼接 ${summary.count} 段 · 字体「${summary.fontLabel}」· 文字「${summary.textScaleLabel}」`}
            </p>
          ) : null}
          {error ? (
            <p className="comic-strip-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {readiness.totalSegments > 0 ? (
          <div className="segment-strips-manifest">
            <p className="segment-strips-manifest-head">
              <span>分段清单</span>
              <span className="segment-strips-manifest-count">
                {readiness.readySegments}/{readiness.totalSegments} 段就绪
              </span>
            </p>
            <ol className="segment-strips-manifest-list">
              {readiness.segments.map((row, index) => {
                const strip = row.stripAssetId ? assetById.get(row.stripAssetId) : undefined;
                const isTextOnly = row.route === "text_only";
                const rowReady = isTextOnly || (row.readyFrames === row.requiredFrames && row.hasCopy);
                const size = strip ? sizes[strip.id] : undefined;
                return (
                  <li key={row.segmentId} className="segment-strips-manifest-row">
                    <span className="segment-strips-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="segment-strips-manifest-info">
                      <div className="segment-strips-manifest-title">
                        <strong>{row.title || `第 ${index + 1} 段`}</strong>
                        <span className="segment-strips-route">
                          {STORYBOARD_ROUTE_LABELS[row.route]}
                        </span>
                      </div>
                      <span className="segment-strips-manifest-meta">
                        {isTextOnly
                          ? "纯文字段 · 拼成纯文字图（文字带）"
                          : `帧 ${row.readyFrames}/${row.requiredFrames} · ${
                              row.hasCopy ? "文案就绪" : "文案不在正文"
                            }`}
                      </span>
                    </div>
                    {strip ? (
                      <figure className="segment-strips-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={contentUrl(strip.id)}
                          alt={strip.altText}
                          onLoad={(event) => {
                            const { naturalWidth, naturalHeight } = event.currentTarget;
                            setSizes((current) =>
                              current[strip.id]
                                ? current
                                : {
                                    ...current,
                                    [strip.id]: { width: naturalWidth, height: naturalHeight }
                                  }
                            );
                          }}
                        />
                        <figcaption>{size ? `${size.width}×${size.height}` : "段图"}</figcaption>
                      </figure>
                    ) : (
                      <span
                        className={`segment-strips-state segment-strips-state-${
                          rowReady ? "ready" : "pending"
                        }`}
                      >
                        {isTextOnly ? "纯文字" : rowReady ? "待拼接" : "待补齐"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}
