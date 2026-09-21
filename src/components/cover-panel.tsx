"use client";

import { Images, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Article } from "@/features/articles/domain";
import {
  defaultCoverPrompt,
  type ImageAspectRatio,
  type ImageAsset,
  type ImageLibraryItem
} from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
import type { ImageMutationPayload } from "./image-planning-panel";

/**
 * 第四步「封面图」配置面板（分镜文章专用）。
 *
 * 为什么分镜文章需要它：封面是公众号草稿的**头图**，发布门在正文校验之后检查
 * 「存在一张已生成的封面」，没有就直接拒推（`publish-article-draft` 的 no_cover）。
 * 旧文章的封面由视觉规划器顺手产出，而分镜文章在第四步锁定规划
 * （`planImages` 返回 storyboard_locked），于是它永远拿不到封面，
 * 也就永远推不了草稿——这个面板就是补上这个缺口。
 *
 * 四件事：提示词可编辑后重生成、生图模型可选、封面比例可选、从素材库挑图。
 * 封面是文章级资产（anchorBlockId 恒为 null），不进正文序列，
 * 只在公众号草稿里当头图，所以这里没有「插入位置」。
 */

const aspectRatios: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "cover", label: "封面 2.35:1" },
  { value: "landscape", label: "横图 3:2" },
  { value: "square", label: "方图 1:1" },
  { value: "portrait", label: "竖图 3:4" }
];

/** 预览框按比例留位，避免图加载完成后页面跳动（与配图规划面板同一张表）。 */
const aspectRatioCss: Record<ImageAspectRatio, string> = {
  cover: "2.35 / 1",
  landscape: "3 / 2",
  square: "1 / 1",
  portrait: "3 / 4"
};

const statusLabels: Record<ImageAsset["status"], string> = {
  planned: "待生成",
  placeholder: "待生成",
  generating: "生成中",
  generated: "已生成",
  disabled: "已停用",
  failed: "生成失败"
};

/**
 * 草稿与资产的绑定键：资产换了（重新生成、换版）就换一份草稿，
 * 否则输入框会一直显示上一版的提示词。没有资产时用 "new" 代表「还没建槽位」。
 */
function draftKey(asset: ImageAsset | null) {
  return asset ? `${asset.id}:${asset.updatedAt}` : "new";
}

function coverSrc(asset: ImageAsset) {
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

function generationSrc(generation: ImageLibraryItem) {
  return generation.publicUrl ?? `/api/image-generations/${generation.id}/content`;
}

export interface CoverPanelProps {
  article: Article;
  assets: ImageAsset[];
  readOnly?: boolean;
  /** 文章正在保存时锁住：生成要基于一个稳定的文章版本。 */
  disabled?: boolean;
  onResult: (payload: ImageMutationPayload) => void;
  /** 服务端配了图片生成能力时为 true；false（无生图服务 / E2E）时只给「建槽位」入口。 */
  imageGenerationEnabled?: boolean;
  /**
   * 一站式出图：幂等建槽位 + 生成。已有封面时不重建槽位、也不覆盖提示词，
   * 只按当前提示词重新出图。
   */
  generateCover?: (input: {
    prompt: string;
    aspectRatio: ImageAspectRatio;
    model?: string;
  }) => Promise<ImageMutationPayload>;
  /** 只建槽位不出图：没有生图能力时让作者先把封面配置写好。 */
  ensureCover?: (
    expectedUpdatedAt: string,
    input?: { prompt?: string; aspectRatio?: ImageAspectRatio }
  ) => Promise<ImageMutationPayload>;
  /**
   * 三帧横拼封面：取文章已生成的分镜帧横向拼成 2.35:1 头图。
   * 纯 CPU 拼接（服务端 sharp），不耗生图能力；assetIds 省略时按段落顺序取前三帧。
   * 已有的 AI 封面会被覆盖，旧版本仍留在素材库可找回。
   */
  composeCover?: (
    expectedUpdatedAt: string,
    assetIds?: string[]
  ) => Promise<ImageMutationPayload>;
  /** 改提示词 / 比例 / 替代文本（服务端会把 manuallyEdited 置真，防批量顶替）。 */
  updateAsset?: (
    assetId: string,
    input: ImageAssetPatch & { expectedUpdatedAt: string }
  ) => Promise<ImageMutationPayload>;
  /** 从素材库挑一张挪到封面槽位（一图一主人，原位置自动回落）。 */
  selectGeneration?: (
    assetId: string,
    generationId: string,
    expectedUpdatedAt: string
  ) => Promise<ImageMutationPayload>;
}

export function CoverPanel({
  article,
  assets,
  readOnly = false,
  disabled = false,
  onResult,
  imageGenerationEnabled = false,
  generateCover,
  ensureCover,
  composeCover,
  updateAsset,
  selectGeneration
}: CoverPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [imageModels, setImageModels] = useState<Array<{ id: string; provider: string }>>([]);
  const [promptDraft, setPromptDraft] = useState<{ key: string; value: string } | null>(null);
  const [ratioDraft, setRatioDraft] = useState<{ key: string; value: ImageAspectRatio } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<ImageLibraryItem[] | null>(null);

  const cover = assets.find((asset) => asset.type === "cover") ?? null;
  const key = draftKey(cover);
  const prompt =
    promptDraft && promptDraft.key === key
      ? promptDraft.value
      : (cover?.prompt ?? defaultCoverPrompt(article));
  const aspectRatio =
    ratioDraft && ratioDraft.key === key
      ? ratioDraft.value
      : (cover?.aspectRatio ?? "cover");

  const locked = readOnly || disabled || busy;
  const hasGeneration = imageGenerationEnabled && Boolean(generateCover);
  // 「生成中」与「已停用」都不能再点生成：服务端对这两种状态直接返回 400。
  const canGenerate =
    hasGeneration && cover?.status !== "generating" && cover?.status !== "disabled";
  // 建槽位只在没有生图能力时才单独给入口；有生图能力时主按钮已经顺带建好了槽位。
  const canCreate = !cover && !hasGeneration && Boolean(ensureCover);
  // 横拼不耗生图能力（服务端 sharp 拼接），但没有封面时它会先幂等建槽位再拼。
  // 「生成中」与「已停用」同样被服务端 beginGeneration 拒绝，提前拦掉。
  const canCompose =
    Boolean(composeCover) && cover?.status !== "generating" && cover?.status !== "disabled";
  // 停用的封面（旧流程重新规划时被让位）需要先启用才能再出图，否则是个死胡同。
  const canReenable = cover?.status === "disabled" && Boolean(updateAsset);

  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch(`/api/articles/${article.id}/image-generations`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { generations?: ImageLibraryItem[] };
      setLibrary(Array.isArray(body.generations) ? body.generations : []);
    } catch {
      // 素材库只是挑图的便利入口，拉不到就空着，不影响生成链路。
      setLibrary([]);
    }
  }, [article.id]);

  // 生图模型目录：聚合所有已配置站点（IMAGE_* / IMAGE2_*），拉不到就只剩「默认模型」。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/image-models")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { models?: Array<{ id: string; provider: string }> }) => {
        if (!cancelled) setImageModels(Array.isArray(data.models) ? data.models : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 每次展开都重拉：生成/换版之后列表会变，缓存一份反而更容易给出过期的版本。
  useEffect(() => {
    if (!libraryOpen) return;
    // 外部系统拉取：setState 只发生在 await 之后的异步延续里，不是同步级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibrary();
  }, [libraryOpen, loadLibrary]);

  function toggleLibrary() {
    setLibraryOpen((open) => !open);
    // 收起时也清掉，下次展开一定重新读一遍（清空动作放在事件里，避免 effect 里同步 setState）。
    setLibrary(null);
  }

  async function run(operation: () => Promise<ImageMutationPayload>) {
    setBusy(true);
    setError("");
    try {
      onResult(await operation());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function savePrompt() {
    if (!cover || !updateAsset) return;
    const next = prompt.trim();
    if (!next || next === cover.prompt) return;
    void run(() => updateAsset(cover.id, { prompt: next, expectedUpdatedAt: article.updatedAt }));
  }

  function saveAspectRatio(next: ImageAspectRatio) {
    setRatioDraft({ key, value: next });
    if (!cover || !updateAsset) return;
    void run(() => updateAsset(cover.id, { aspectRatio: next, expectedUpdatedAt: article.updatedAt }));
  }

  function createCover() {
    if (!ensureCover) return;
    void run(() =>
      ensureCover(article.updatedAt, { prompt: prompt.trim(), aspectRatio })
    );
  }

  function composeFromFrames() {
    if (!composeCover) return;
    // 帧选择交给后端缺省（按段落顺序取前三张已生成帧）。
    void run(() => composeCover(article.updatedAt));
  }

  function reenableCover() {
    if (!cover || !updateAsset) return;
    void run(() =>
      updateAsset(cover.id, { enabled: true, expectedUpdatedAt: article.updatedAt })
    );
  }

  function generate() {
    if (!generateCover) return;
    void run(() =>
      generateCover({
        prompt: prompt.trim(),
        aspectRatio,
        ...(imageModel ? { model: imageModel } : {})
      })
    );
  }

  function pickFromLibrary(generation: ImageLibraryItem) {
    if (!cover || !selectGeneration) return;
    void run(() =>
      selectGeneration(cover.id, generation.id, article.updatedAt)
    );
  }

  const badge = cover
    ? { tone: cover.status, label: statusLabels[cover.status] }
    : { tone: "missing" as const, label: "未创建" };

  return (
    <section className="cover-panel" aria-labelledby="cover-panel-heading">
      <header className="cover-panel-head">
        <div className="cover-panel-title">
          <span className="cover-panel-icon" aria-hidden="true">
            <Images size={16} />
          </span>
          <div>
            <h2 id="cover-panel-heading">封面图</h2>
            <p className="cover-panel-sub">
              公众号草稿的头图。推送前必须有一张<strong>已生成</strong>的封面，否则推送会被拒。
            </p>
          </div>
        </div>
        <span className={`cover-panel-badge cover-panel-badge-${badge.tone}`}>{badge.label}</span>
      </header>

      <div className="cover-panel-body">
        <div className="cover-panel-preview">
          {cover ? (
            // 占位图走内部 API 路由，动态地址，next/image 不适用。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="cover-panel-image"
              src={coverSrc(cover)}
              alt={cover.altText || "封面图"}
              loading="lazy"
            />
          ) : (
            <div className="cover-panel-empty" style={{ aspectRatio: aspectRatioCss[aspectRatio] }}>
              <span>还没有封面图</span>
            </div>
          )}
          {cover?.status === "generating" ? (
            <span className="cover-panel-generating">
              <Loader2 size={13} className="is-spinning" aria-hidden="true" />
              生成中
            </span>
          ) : null}
        </div>

        <div className="cover-panel-fields">
          <label className="cover-panel-field">
            <span>提示词</span>
            <textarea
              aria-label="封面提示词"
              rows={4}
              value={prompt}
              disabled={locked}
              onChange={(event) =>
                setPromptDraft({ key, value: event.target.value })
              }
              onBlur={savePrompt}
            />
          </label>

          <div className="cover-panel-row">
            <label className="cover-panel-field">
              <span>比例</span>
              <select
                aria-label="封面比例"
                value={aspectRatio}
                disabled={locked}
                onChange={(event) => saveAspectRatio(event.target.value as ImageAspectRatio)}
              >
                {aspectRatios.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </option>
                ))}
              </select>
            </label>

            {hasGeneration && imageModels.length > 0 ? (
              <label className="cover-panel-field">
                <span>生图模型</span>
                <select
                  aria-label="封面生图模型"
                  value={imageModel}
                  disabled={locked}
                  onChange={(event) => setImageModel(event.target.value)}
                  title="生成封面使用的模型；可跨站点选择，报错时可换模型重试"
                >
                  <option value="">默认模型</option>
                  {imageModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {new Set(imageModels.map((entry) => entry.provider)).size > 1
                        ? `${item.id}（${item.provider}）`
                        : item.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="cover-panel-actions">
            {canGenerate ? (
              <button
                className="button button-primary"
                type="button"
                disabled={locked}
                onClick={generate}
              >
                {cover?.status === "generated" ? (
                  <RefreshCw size={15} aria-hidden="true" />
                ) : (
                  <Wand2 size={15} aria-hidden="true" />
                )}
                {cover?.status === "generated" ? "重新生成封面图" : "生成封面图"}
              </button>
            ) : null}
            {canCreate ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={locked}
                onClick={createCover}
              >
                <Wand2 size={15} aria-hidden="true" />
                创建封面槽位
              </button>
            ) : null}
            {canReenable ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={locked}
                onClick={reenableCover}
              >
                <RefreshCw size={15} aria-hidden="true" />
                启用封面
              </button>
            ) : null}
            {canCompose ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={locked}
                title="取文章前三张已生成的分镜帧，横向拼成 2.35:1 封面；已有封面会被覆盖（旧版本留在素材库可找回）"
                onClick={composeFromFrames}
              >
                <Images size={15} aria-hidden="true" />
                {cover?.status === "generated" ? "重新拼接封面" : "三帧横拼封面"}
              </button>
            ) : null}
            {cover && selectGeneration ? (
              <button
                className="button button-secondary"
                type="button"
                aria-expanded={libraryOpen}
                disabled={locked}
                onClick={toggleLibrary}
              >
                <Images size={15} aria-hidden="true" />
                从素材库挑图
              </button>
            ) : null}
            {busy ? (
              <span className="cover-panel-busy" role="status">
                <Loader2 size={13} className="is-spinning" aria-hidden="true" />
                正在处理...
              </span>
            ) : null}
          </div>

          {!hasGeneration && !cover ? (
            <p className="cover-panel-hint">
              当前没有可用的生图服务，先把封面配置建好；等生图能力就绪后再回来出图。
            </p>
          ) : null}
          {error ? (
            <p className="cover-panel-error" role="alert">
              {error}
            </p>
          ) : null}

          {libraryOpen && cover ? (
            <div className="cover-panel-library">
              <p className="cover-panel-library-hint">
                点一张挪到封面槽位——同一张图只会出现在一个位置，移走之后原位置会自动回落到它剩下的最新一版。
              </p>
              {library === null ? (
                <p className="cover-panel-library-state">正在读取素材库...</p>
              ) : library.length === 0 ? (
                <p className="cover-panel-library-state">本文还没有生成过任何图片。</p>
              ) : (
                <ol className="cover-panel-library-grid">
                  {library.map((generation) => (
                    <li key={generation.id}>
                      <button
                        type="button"
                        className={`cover-panel-library-thumb${generation.selected ? " is-current" : ""}`}
                        disabled={locked}
                        title={`${generation.assetPurpose} · ${generation.prompt.slice(0, 40)}`}
                        aria-label={`把这张图挪到封面槽位：${generation.assetPurpose}`}
                        onClick={() => pickFromLibrary(generation)}
                      >
                        {/* 版本文件按 generationId 命名，URL 不可变，不需要破缓存参数。 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={generationSrc(generation)} alt="" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
