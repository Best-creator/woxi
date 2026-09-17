"use client";

import { Images, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Article } from "@/features/articles/domain";
import {
  COMIC_STRIP_MODE_LABELS,
  type ComicStripMode,
  type ImageAsset
} from "@/features/images/domain";
import { inspectComicStrip } from "@/features/images/plan-comic-strip";
import { withStripsRestored } from "@/features/images/consumed-content";
import type { ImageMutationPayload } from "./image-planning-panel";

// 这里不引 merge-image-blocks 的 imageContentUrl：那个模块带 node:crypto，
// 进客户端组件会把浏览器构建打挂。路径形态和配图面板保持一致即可。
const contentUrl = (assetId: string) => `/api/image-assets/${assetId}/content`;

export interface ComicStripControlProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：拼图要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 拼图会重写正文，所以回传整份文章与资产，交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  /** 排法由模型按正文自动决定（mode 走缺省 auto），不再提供手动选择。 */
  composeComicStrip: (expectedUpdatedAt: string) => Promise<ImageMutationPayload>;
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
      // 模型的排法选择回显给作者看（拼图依据变得透明）；取消长图时清掉旧决策。
      const firstStrip = result.strips?.[0];
      setDecision(
        firstStrip
          ? { mode: firstStrip.mode as ComicStripMode, reason: firstStrip.reason ?? "" }
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
      </div>

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
          onClick={() => void run(() => composeComicStrip(article.updatedAt))}
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
