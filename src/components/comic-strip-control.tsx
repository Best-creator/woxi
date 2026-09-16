"use client";

import { Images, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Article } from "@/features/articles/domain";
import {
  COMIC_STRIP_MODES,
  COMIC_STRIP_MODE_LABELS,
  type ComicStripMode,
  type ComicStripModeChoice,
  type ImageAsset
} from "@/features/images/domain";
import { inspectComicStrip } from "@/features/images/plan-comic-strip";
import { withStripsRestored } from "@/features/images/consumed-content";
import type { ImageMutationPayload } from "./image-planning-panel";

// 这里不引 merge-image-blocks 的 imageContentUrl：那个模块带 node:crypto，
// 进客户端组件会把浏览器构建打挂。路径形态和配图面板保持一致即可。
const contentUrl = (assetId: string) => `/api/image-assets/${assetId}/content`;

/** 三种排法各自适合什么画面，写在按钮下面而不是塞进按钮里——按钮里放不下，也没人读。 */
const MODE_HINTS: Record<ComicStripMode, string> = {
  image_text: "一格一图，文案跟在这格图后面",
  text_image: "文案在上、图在下，先铺垫再给画面",
  image_text_image: "分镜两两成组，文案落在两张图正中间"
};

export interface ComicStripControlProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：拼图要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 拼图会重写正文，所以回传整份文章与资产，交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  composeComicStrip: (
    expectedUpdatedAt: string,
    mode: ComicStripModeChoice
  ) => Promise<ImageMutationPayload>;
  removeComicStrip: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
}

export function ComicStripControl({
  article,
  assets,
  readOnly = false,
  disabled = false,
  onResult,
  composeComicStrip,
  removeComicStrip
}: ComicStripControlProps) {
  // 默认交给模型按正文内容选排法；点具体排法是手动覆盖。
  const [mode, setMode] = useState<ComicStripModeChoice>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [decision, setDecision] = useState<{ mode: ComicStripMode; reason: string } | null>(null);

  // 和真正拼图共用同一套识别逻辑：按钮亮着就一定能拼成，不会点下去才说拼不了。
  // 拼过长图之后正文里只剩那张长图，必须先把被它替换掉的图文「临时」放回来再判——
  // 否则会以为这篇没有分镜，「按新模式重拼」明明该能点却一直置灰。
  const readiness = useMemo(
    () => inspectComicStrip(withStripsRestored(article.blocks, assets), assets),
    [article.blocks, assets]
  );
  const strip = useMemo(
    () => assets.find((asset) => asset.type === "comic_strip") ?? null,
    [assets]
  );
  const pendingImages = readiness.groups.reduce(
    (total, group) =>
      total +
      group.panels.filter((panel) => panel.asset.status !== "generated" || !panel.asset.filePath)
        .length,
    0
  );

  const ready = readiness.groups.length > 0 && pendingImages === 0;
  const locked = readOnly || disabled || busy;

  const hint = (() => {
    if (strip) return "长图已经替换掉正文里的分镜图文；取消长图可原样还原。";
    if (readiness.panelCount === 0) return "正文里还没有分镜配图，先在上面规划配图再回来拼。";
    if (readiness.panelCount < 2) return "至少要两格分镜才拼得成长图。";
    if (pendingImages > 0) return `还有 ${pendingImages} 格分镜没生成图片，补齐后才能拼。`;
    return `已识别 ${readiness.panelCount} 格分镜，会拼成 ${readiness.groups.length} 张长图。`;
  })();

  async function run(action: () => Promise<ImageMutationPayload>) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setSize(null);
      // 自动模式下把模型的排法选择回显出来；取消长图时清掉旧决策。
      const firstStrip = result.strips?.[0];
      setDecision(
        firstStrip && mode === "auto"
          ? { mode: firstStrip.mode as ComicStripMode, reason: firstStrip.reason }
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
    <section className="comic-strip-control" aria-label="漫画长图">
      <div className="comic-strip-head">
        <strong>
          <Images size={16} aria-hidden="true" />
          漫画长图
        </strong>
        <p>把分镜图和中间的文字烘进同一张图，正文就从「图文交替」变成连续漫画。</p>
      </div>

      <div className="comic-strip-modes" role="radiogroup" aria-label="拼图模式">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "auto"}
          className={`comic-strip-mode${mode === "auto" ? " comic-strip-mode-active" : ""}`}
          disabled={locked}
          onClick={() => setMode("auto")}
        >
          <Sparkles size={13} aria-hidden="true" />
          智能选择
        </button>
        {COMIC_STRIP_MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={mode === candidate}
            className={`comic-strip-mode${mode === candidate ? " comic-strip-mode-active" : ""}`}
            disabled={locked}
            onClick={() => setMode(candidate)}
          >
            {COMIC_STRIP_MODE_LABELS[candidate]}
          </button>
        ))}
      </div>
      <p className="comic-strip-mode-hint">
        {mode === "auto" ? "模型读完正文，自动从三种排法里挑最合适的" : MODE_HINTS[mode]}
      </p>
      {decision ? (
        <p className="comic-strip-mode-hint" role="status">
          模型选了「{COMIC_STRIP_MODE_LABELS[decision.mode]}」：{decision.reason}
        </p>
      ) : null}

      <div className="comic-strip-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={locked || !ready}
          onClick={() => void run(() => composeComicStrip(article.updatedAt, mode))}
        >
          {busy ? (
            <Loader2 size={16} className="comic-strip-spin" aria-hidden="true" />
          ) : (
            <Images size={16} aria-hidden="true" />
          )}
          {busy ? "正在拼图..." : strip ? "按新模式重拼" : "合成漫画长图"}
        </button>
        {strip ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={locked}
            onClick={() => void run(() => removeComicStrip(article.updatedAt))}
          >
            <Trash2 size={16} aria-hidden="true" />
            取消长图
          </button>
        ) : null}
      </div>

      <p className="comic-strip-hint" role="status">
        {hint}
      </p>
      {error ? (
        <p className="comic-strip-error" role="alert">
          {error}
        </p>
      ) : null}

      {strip ? (
        <figure className="comic-strip-result">
          {/* 长图走内部 API 路由，地址动态，next/image 不适用。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={contentUrl(strip.id)}
            alt={strip.altText}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              })
            }
          />
          <figcaption>
            {size ? `${size.width} × ${size.height}` : "长图"} · {strip.purpose}
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
