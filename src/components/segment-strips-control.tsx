"use client";

import { Images, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Article } from "@/features/articles/domain";
import {
  STORYBOARD_FONT_OPTIONS,
  resolveStoryboardFont,
  type ImageAsset
} from "@/features/images/domain";
import { inspectSegmentStrips } from "@/features/images/inspect-segment-strips";
import type { ImageMutationPayload } from "./image-planning-panel";

export interface SegmentStripsControlProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：拼接要基于一个稳定的正文版本。 */
  disabled?: boolean;
  /** 拼接会重写正文，回传整份文章与资产交给工作台统一收口。 */
  onResult: (payload: ImageMutationPayload) => void;
  /** fontId 随拼接提交，由后端在校验全过之后持久化进 planning.storyboardFontId。 */
  composeSegmentStrips: (
    expectedUpdatedAt: string,
    fontId?: string
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
  const [summary, setSummary] = useState<{ count: number; fontLabel: string } | null>(null);
  // 字体选择本地暂存、随拼接提交持久化：未拼接前刷新或离开都不写库。
  const [fontId, setFontId] = useState(
    () => resolveStoryboardFont(article.planning.storyboardFontId).id
  );

  // 与真正拼接共用同一套就绪判定（服务端 composeSegmentStrips 的校验同构）：
  // 按钮亮着就一定能拼成，不会点下去才说拼不了。
  const readiness = useMemo(() => inspectSegmentStrips(article, assets), [article, assets]);
  const stripsExist = useMemo(
    () => assets.some((asset) => asset.type === "comic_strip"),
    [assets]
  );
  const locked = readOnly || disabled || busy;
  const ready =
    readiness.totalSegments > 0 &&
    readiness.pendingFrames === 0 &&
    readiness.missingCopySegments === 0;

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
    return `已就绪 ${readiness.readySegments} 段，将拼成 ${readiness.totalSegments} 张段图，文案会按所选字体烘进图里。`;
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
      setSummary(result.strips?.length ? { count: result.strips.length, fontLabel } : null);
      onResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="segment-strips-control" aria-label="分段拼接">
      <div className="comic-strip-head">
        <strong>
          <Images size={16} aria-hidden="true" />
          分段拼接
        </strong>
        <p>每个分镜段各拼一张段图，文案按所选字体烘进图里。</p>
      </div>

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
      </div>

      <div className="comic-strip-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={locked || !ready}
          onClick={() => void run(() => composeSegmentStrips(article.updatedAt, fontId))}
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
            className="button button-secondary"
            type="button"
            disabled={locked}
            onClick={() => void run(() => removeSegmentStrips(article.updatedAt))}
          >
            <Trash2 size={16} aria-hidden="true" />
            取消段图
          </button>
        ) : null}
      </div>

      <p className="comic-strip-hint" role="status">
        {hint}
      </p>
      {summary ? (
        <p className="segment-strips-summary" role="status">
          已拼接 {summary.count} 段 · 字体「{summary.fontLabel}」
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
