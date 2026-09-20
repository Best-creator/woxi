"use client";

import { Eye, Save, Send, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlockEditor } from "@/components/block-editor";
import { ComicStripControl } from "@/components/comic-strip-control";
import { CoverPanel } from "@/components/cover-panel";
import { GenerationPanel } from "@/components/generation-panel";
import type { ImageMutationPayload } from "@/components/image-planning-panel";
import { KnowledgeBriefEditor } from "@/components/knowledge-brief-editor";
import { SegmentFramesPanel } from "@/components/segment-frames-panel";
import { SegmentStripsControl } from "@/components/segment-strips-control";
import { SourcePanel } from "@/components/source-panel";
import { WechatPreview } from "@/components/wechat-preview";
import { WorkflowStepper } from "@/components/workflow-stepper";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { SaveArticleResult } from "@/features/articles/repository";
import type { ImageAspectRatio, ImageAsset } from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
import type { ImagePlanGuideOptions } from "@/components/image-planning-panel";
import type { ContentRevisionSnapshot, ArticleRevision, OutlineRevisionSnapshot } from "@/features/revisions/domain";
import type { SourceDocument } from "@/features/sources/domain";
import type { PublicLlmConfig } from "@/server/config";
import { getWorkflowSteps, type WorkflowStep } from "./workflow";
import type { OutlineVersionReviews, OutlineWorkspaceReview } from "./outline-state";
import type { ContentVersionReviews, ContentWorkspaceReview } from "./content-state";
import { OutlineWorkspace } from "./outline/outline-workspace";
import {
  ContentWorkspace,
  type ApproveContent,
  type GenerateContent,
  type RestoreVersion,
  type ReviewContent,
  type ReviseContent,
  type SaveVersion
} from "./content/content-workspace";

type SaveArticle = (
  article: Article,
  expectedUpdatedAt: string
) => Promise<SaveArticleResult>;

type PlanImages = (articleId: string, expectedUpdatedAt: string, model?: string, options?: ImagePlanGuideOptions) => Promise<ImageMutationPayload>;
type UpdateImageAsset = (
  articleId: string,
  assetId: string,
  input: ImageAssetPatch & { expectedUpdatedAt: string }
) => Promise<ImageMutationPayload>;
type DeleteImageAsset = (
  articleId: string,
  assetId: string,
  expectedUpdatedAt: string
) => Promise<ImageMutationPayload>;

type GenerateImageAssetRequest = (
  articleId: string,
  assetId: string,
  expectedUpdatedAt: string,
  model?: string
) => Promise<ImageMutationPayload>;

type GenerateImageBatchRequest = (
  articleId: string,
  expectedUpdatedAt: string,
  model?: string
) => Promise<ImageMutationPayload>;

type SelectImageGeneration = (
  articleId: string,
  assetId: string,
  generationId: string,
  expectedUpdatedAt: string
) => Promise<ImageMutationPayload>;

type DeleteImageGeneration = (
  articleId: string,
  generationId: string,
  expectedUpdatedAt: string
) => Promise<ImageMutationPayload>;

type ComposeComicStrip = (
  articleId: string,
  expectedUpdatedAt: string
) => Promise<ImageMutationPayload>;

type RemoveComicStrip = (
  articleId: string,
  expectedUpdatedAt: string
) => Promise<ImageMutationPayload>;

type ComposeSegmentStrips = (
  articleId: string,
  expectedUpdatedAt: string,
  fontId?: string,
  textScaleId?: string
) => Promise<ImageMutationPayload>;

type EnsureCover = (
  articleId: string,
  expectedUpdatedAt: string,
  input?: { prompt?: string; aspectRatio?: ImageAspectRatio }
) => Promise<ImageMutationPayload>;

async function publishWechatRequest(
  articleId: string,
  themeId: "ink" | "clear" | "warm",
  force: boolean
): Promise<{ mediaId: string }> {
  const response = await fetch(`/api/articles/${articleId}/publish-wechat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ themeId, force })
  });
  const result = (await response.json()) as { record?: { mediaId: string }; error?: string };
  if (!response.ok || !result.record) {
    throw new Error(result.error ?? "推送失败，请稍后重试");
  }
  return { mediaId: result.record.mediaId };
}

export interface ArticleWorkspaceProps {
  initialArticle: Article;
  initialSources?: SourceDocument[];
  initialImageAssets?: ImageAsset[];
  saveArticle?: SaveArticle;
  planImages?: PlanImages;
  updateImageAsset?: UpdateImageAsset;
  deleteImageAsset?: DeleteImageAsset;
  refreshPlaceholder?: DeleteImageAsset;
  generateImage?: GenerateImageAssetRequest;
  generateBatch?: GenerateImageBatchRequest;
  selectImageGeneration?: SelectImageGeneration;
  deleteImageGeneration?: DeleteImageGeneration;
  /** 把分镜图与文案拼成漫画长图（三种排法之一）。 */
  composeComicStrip?: ComposeComicStrip;
  /** 取消长图，正文回到原来的分镜图文。 */
  removeComicStrip?: RemoveComicStrip;
  /** 分段拼接：第三步分镜设计的每段各拼一张段图（fontId/textScaleId 随请求持久化）。 */
  composeSegmentStrips?: ComposeSegmentStrips;
  /** 建封面槽位（幂等）：分镜文章第四步的封面配置入口。 */
  ensureCover?: EnsureCover;
  /** 服务端配置了图片生成能力时为 true，控制生成入口显隐。 */
  imageGenerationEnabled?: boolean;
  /** 服务端配置了公众号凭据时为 true，控制「推送到草稿箱」入口显隐。 */
  wechatPublishEnabled?: boolean;
  autosaveDelayMs?: number;
  initialStep?: string | null;
  initialVersions?: ArticleRevision<OutlineRevisionSnapshot>[];
  initialReview?: OutlineWorkspaceReview;
  initialVersionReviews?: OutlineVersionReviews;
  initialContentVersions?: ArticleRevision<ContentRevisionSnapshot>[];
  initialContentReview?: ContentWorkspaceReview;
  initialContentVersionReviews?: ContentVersionReviews;
  generateContent?: GenerateContent;
  reviseContent?: ReviseContent;
  reviewContent?: ReviewContent;
  approveContent?: ApproveContent;
  saveContentVersion?: SaveVersion;
  restoreContentVersion?: RestoreVersion;
  llmConfig?: PublicLlmConfig;
}

async function saveArticleRequest(
  article: Article,
  expectedUpdatedAt: string
): Promise<SaveArticleResult> {
  const response = await fetch(`/api/articles/${article.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...article, expectedUpdatedAt })
  });
  if (response.status === 409) {
    return { kind: "conflict" };
  }
  const result = (await response.json()) as { article?: Article; error?: string };
  if (!response.ok || !result.article) {
    throw new Error(result.error ?? "保存失败");
  }
  return { kind: "saved", article: result.article };
}

async function imageMutationRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: object
): Promise<ImageMutationPayload> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = (await response.json()) as {
    article?: Article;
    assets?: ImageAsset[];
    strips?: ImageMutationPayload["strips"];
    fontFamily?: ImageMutationPayload["fontFamily"];
    batch?: ImageMutationPayload["batch"];
    error?: string;
  };
  if (!response.ok || !result.article || !result.assets) {
    // 生成失败的服务端也已落库（帧置 failed、文章推进），响应里带着最新状态：
    // 挂到 Error 上让上层回灌，否则本地令牌落后，下一次写操作必撞 409。
    const failure = new Error(result.error ?? "配图操作失败，请稍后重试") as Error & {
      article?: Article;
      assets?: ImageAsset[];
    };
    if (result.article && result.assets) {
      failure.article = result.article;
      failure.assets = result.assets;
    }
    throw failure;
  }
  return {
    article: result.article,
    assets: result.assets,
    strips: result.strips,
    fontFamily: result.fontFamily,
    batch: result.batch
  };
}

function planImagesRequest(
  articleId: string,
  expectedUpdatedAt: string,
  model?: string,
  options?: ImagePlanGuideOptions
) {
  return imageMutationRequest(`/api/articles/${articleId}/image-plan`, "POST", {
    expectedUpdatedAt,
    ...(model ? { model } : {}),
    ...(options?.style ? { style: options.style } : {}),
    ...(options?.characterId ? { characterId: options.characterId } : {})
  });
}

function updateImageAssetRequest(
  articleId: string,
  assetId: string,
  input: ImageAssetPatch & { expectedUpdatedAt: string }
) {
  return imageMutationRequest(`/api/articles/${articleId}/image-assets/${assetId}`, "PATCH", input);
}

function deleteImageAssetRequest(articleId: string, assetId: string, expectedUpdatedAt: string) {
  return imageMutationRequest(`/api/articles/${articleId}/image-assets/${assetId}`, "DELETE", { expectedUpdatedAt });
}

function refreshPlaceholderRequest(articleId: string, assetId: string, expectedUpdatedAt: string) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-assets/${assetId}/placeholder`,
    "POST",
    { expectedUpdatedAt }
  );
}

function generateImageRequest(
  articleId: string,
  assetId: string,
  expectedUpdatedAt: string,
  model?: string
) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-assets/${assetId}/generate`,
    "POST",
    { expectedUpdatedAt, ...(model ? { model } : {}) }
  );
}

function generateImageBatchRequest(
  articleId: string,
  expectedUpdatedAt: string,
  model?: string
) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-assets/generate-batch`,
    "POST",
    { expectedUpdatedAt, ...(model ? { model } : {}) }
  );
}

function selectGenerationRequest(
  articleId: string,
  assetId: string,
  generationId: string,
  expectedUpdatedAt: string
) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-assets/${assetId}/generations`,
    "POST",
    { generationId, expectedUpdatedAt }
  );
}

function deleteGenerationRequest(
  articleId: string,
  generationId: string,
  expectedUpdatedAt: string
) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-generations/${generationId}`,
    "DELETE",
    { expectedUpdatedAt }
  );
}

function composeComicStripRequest(
  articleId: string,
  expectedUpdatedAt: string
) {
  // 排法交给模型决定（mode 缺省 auto）；手动选择入口已按产品决策移除。
  return imageMutationRequest(`/api/articles/${articleId}/comic-strip`, "POST", {
    expectedUpdatedAt
  });
}

function removeComicStripRequest(articleId: string, expectedUpdatedAt: string) {
  // 版本号走查询串：DELETE 带请求体容易被中间层吞掉。
  const query = new URLSearchParams({ expectedUpdatedAt }).toString();
  return imageMutationRequest(
    `/api/articles/${articleId}/comic-strip?${query}`,
    "DELETE",
    {}
  );
}

function composeSegmentStripsRequest(
  articleId: string,
  expectedUpdatedAt: string,
  fontId?: string,
  textScaleId?: string
) {
  // 字体与文字大小都可选：传了就由后端在校验全过之后一并持久化进 planning。
  return imageMutationRequest(`/api/articles/${articleId}/segment-strips`, "POST", {
    expectedUpdatedAt,
    ...(fontId ? { fontId } : {}),
    ...(textScaleId ? { textScaleId } : {})
  });
}

function ensureCoverRequest(
  articleId: string,
  expectedUpdatedAt: string,
  input?: { prompt?: string; aspectRatio?: ImageAspectRatio }
) {
  return imageMutationRequest(`/api/articles/${articleId}/cover`, "POST", {
    expectedUpdatedAt,
    ...(input?.prompt ? { prompt: input.prompt } : {}),
    ...(input?.aspectRatio ? { aspectRatio: input.aspectRatio } : {})
  });
}

export function ArticleWorkspace({
  initialArticle,
  initialSources = [],
  initialImageAssets = [],
  saveArticle = saveArticleRequest,
  planImages = planImagesRequest,
  updateImageAsset = updateImageAssetRequest,
  deleteImageAsset = deleteImageAssetRequest,
  refreshPlaceholder = refreshPlaceholderRequest,
  generateImage = generateImageRequest,
  generateBatch = generateImageBatchRequest,
  selectImageGeneration = selectGenerationRequest,
  deleteImageGeneration = deleteGenerationRequest,
  composeComicStrip = composeComicStripRequest,
  removeComicStrip = removeComicStripRequest,
  composeSegmentStrips = composeSegmentStripsRequest,
  ensureCover = ensureCoverRequest,
  imageGenerationEnabled = false,
  wechatPublishEnabled = false,
  autosaveDelayMs = 2_000,
  initialStep = null,
  initialVersions = [],
  initialReview = null,
  initialVersionReviews = {},
  initialContentVersions = [],
  initialContentReview = null,
  initialContentVersionReviews = {},
  generateContent,
  reviseContent,
  reviewContent,
  approveContent,
  saveContentVersion,
  restoreContentVersion,
  llmConfig = { enabled: false, availableModels: [], defaultModel: null }
}: ArticleWorkspaceProps) {
  const [article, setArticle] = useState(initialArticle);
  const [sources, setSources] = useState(initialSources);
  const [imageAssets, setImageAssets] = useState(initialImageAssets);
  const [isDirty, setIsDirty] = useState(false);
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "conflict" | "error"
  >("saved");
  const [message, setMessage] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSettingPublishStatus, setIsSettingPublishStatus] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [requestedStep, setRequestedStep] = useState(initialStep);
  const [outlineVersions, setOutlineVersions] = useState(initialVersions);
  const [outlineReview, setOutlineReview] = useState(initialReview);
  const [outlineVersionReviews, setOutlineVersionReviews] = useState(initialVersionReviews);
  const [contentVersions, setContentVersions] = useState(initialContentVersions);
  const [contentReview, setContentReview] = useState(initialContentReview);
  const [contentVersionReviews, setContentVersionReviews] = useState(initialContentVersionReviews);
  const articleRef = useRef(article);
  const dirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const imageOperationRevisionRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const steps = getWorkflowSteps(article, imageAssets.length, requestedStep);
  const activeStep = steps.find((step) => step.status === "current")?.id ?? "sources";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const updateViewport = () => setIsNarrowViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    // Server navigations can provide a new step without a browser popstate event.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRequestedStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    const currentUrlStep = new URLSearchParams(window.location.search).get("step");
    if (currentUrlStep !== activeStep) {
      window.history.replaceState(null, "", `/articles/${article.id}?step=${activeStep}`);
    }
  }, [activeStep, article.id]);

  useEffect(() => {
    const syncFromHistory = () => setRequestedStep(new URLSearchParams(window.location.search).get("step"));
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    if (!isDirty || autosaveBlocked || saveInFlightRef.current) return;

    const timeout = window.setTimeout(async () => {
      if (saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      const articleToSave = articleRef.current;
      const savingRevision = editRevisionRef.current;
      setSaveState("saving");
      try {
        const result = await saveArticle(articleToSave, articleToSave.updatedAt);
        if (result.kind === "conflict") {
          setSaveState("conflict");
          setMessage("文章已在其他位置更新，本地修改已保留");
          setAutosaveBlocked(true);
          return;
        }
        if (editRevisionRef.current === savingRevision) {
          articleRef.current = result.article;
          setArticle(result.article);
          setSaveState("saved");
          setIsDirty(false);
          dirtyRef.current = false;
          setAutosaveBlocked(false);
          setMessage("");
          localStorage.removeItem(`article-draft:${result.article.id}`);
        } else {
          const rebasedArticle = {
            ...articleRef.current,
            updatedAt: result.article.updatedAt
          };
          articleRef.current = rebasedArticle;
          setArticle(rebasedArticle);
          setIsDirty(true);
          dirtyRef.current = true;
          localStorage.setItem(
            `article-draft:${rebasedArticle.id}`,
            JSON.stringify(rebasedArticle)
          );
        }
      } catch {
        setSaveState("error");
        setMessage("保存失败，本地修改已暂存");
        setAutosaveBlocked(true);
      } finally {
        saveInFlightRef.current = false;
      }
    }, autosaveDelayMs);

    return () => window.clearTimeout(timeout);
  }, [article, autosaveBlocked, autosaveDelayMs, isDirty, saveArticle]);

  function updateArticle(changes: Partial<Article>) {
    const nextArticle = { ...articleRef.current, ...changes };
    articleRef.current = nextArticle;
    editRevisionRef.current += 1;
    setArticle(nextArticle);
    setIsDirty(true);
    dirtyRef.current = true;
    setAutosaveBlocked(false);
    setMessage("");
    localStorage.setItem(`article-draft:${article.id}`, JSON.stringify(nextArticle));
  }

  function updateBlocks(blocks: ContentBlock[]) {
    updateArticle({ blocks });
  }

  /**
   * 落盘尚未保存的编辑，返回服务端最新文章。
   * 正文生成/审核/确认前必须先执行，保证 expectedUpdatedAt 是真实的持久化版本。
   */
  async function prepareArticle(): Promise<Article> {
    const draft = articleRef.current;
    if (!dirtyRef.current) return draft;
    const result = await saveArticle(draft, draft.updatedAt);
    if (result.kind === "conflict") {
      setSaveState("conflict");
      setAutosaveBlocked(true);
      throw new Error("文章已在其他位置更新，请刷新后重试");
    }
    articleRef.current = result.article;
    setArticle(result.article);
    setIsDirty(false);
    dirtyRef.current = false;
    setAutosaveBlocked(false);
    setSaveState("saved");
    localStorage.removeItem(`article-draft:${result.article.id}`);
    return result.article;
  }

  function markPersisted(nextArticle: Article) {
    articleRef.current = nextArticle;
    editRevisionRef.current += 1;
    setArticle(nextArticle);
    setIsDirty(false);
    dirtyRef.current = false;
    setAutosaveBlocked(false);
    setSaveState("saved");
    setMessage("");
    localStorage.removeItem(`article-draft:${nextArticle.id}`);
  }

  /** 发布动线：正文确认后可标记待发布，误操作可撤回。 */
  async function handleSetPublishStatus(status: "ready_to_publish" | "content_ready") {
    setMessage("");
    setIsSettingPublishStatus(true);
    try {
      const saved = await prepareArticle();
      const result = await saveArticle({ ...saved, status }, saved.updatedAt);
      if (result.kind === "conflict") {
        setAutosaveBlocked(true);
        setMessage("文章已在其他位置更新，请刷新页面后重试");
        return;
      }
      markPersisted(result.article);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布状态更新失败，请稍后重试");
    } finally {
      setIsSettingPublishStatus(false);
    }
  }

  function adoptSourceMutation(nextSources: SourceDocument[], nextArticle: Article) {
    setSources(nextSources);
    markPersisted(nextArticle);
    setImageAssets([]);
  }

  const handleOutlineHistoryChange = useCallback((
    versions: ArticleRevision<OutlineRevisionSnapshot>[],
    review: OutlineWorkspaceReview,
    versionReviews: OutlineVersionReviews
  ) => {
    setOutlineVersions(versions);
    setOutlineReview(review);
    setOutlineVersionReviews(versionReviews);
  }, []);

  function selectStep(step: WorkflowStep) {
    setRequestedStep(step);
    window.history.pushState(null, "", `/articles/${article.id}?step=${step}`);
  }

  function beginImageOperation(operation: () => Promise<ImageMutationPayload>) {
    imageOperationRevisionRef.current = editRevisionRef.current;
    return operation().catch((error: unknown) => {
      // 生成失败的响应带回服务端已落库的最新文章与资产：先回灌本地再抛错，
      // 用户点「重试生成」时手里的令牌才是新的，不会陷入 409 死路。
      const failure = error as { article?: Article; assets?: ImageAsset[] };
      if (failure?.article && failure?.assets) {
        applyImageResult({ article: failure.article, assets: failure.assets });
      }
      throw error;
    });
  }

  /**
   * 「创建并生成 / 重新生成封面图」：幂等建槽位 + 出图两步串成一次操作。
   *
   * 两步必须串在同一个操作里（只能调一次 applyImageResult）：
   * - 第二枪要用**服务端刚返回的版本号**，不能沿用本地的——建槽位会推进 updatedAt，
   *   本地令牌不变的话第二枪必撞 409；
   * - applyImageResult 带「操作期间有没有新编辑」的守卫，调两次第二次会被守卫挡掉，
   *   界面反而提示「文章已发生新编辑」。所以这里只把最终结果交回给调用方去 apply。
   */
  async function generateCoverOperation(input: {
    prompt: string;
    aspectRatio: ImageAspectRatio;
    model?: string;
  }): Promise<ImageMutationPayload> {
    const articleId = articleRef.current.id;
    const ensured = await ensureCover(articleId, articleRef.current.updatedAt, {
      ...(input.prompt ? { prompt: input.prompt } : {}),
      aspectRatio: input.aspectRatio
    });
    const cover = ensured.assets.find((asset) => asset.type === "cover");
    if (!cover) throw new Error("封面槽位创建失败，请重试");
    return generateImage(articleId, cover.id, ensured.article.updatedAt, input.model);
  }

  function applyImageResult({ article: nextArticle, assets }: ImageMutationPayload) {
    const operationRevision = imageOperationRevisionRef.current;
    imageOperationRevisionRef.current = null;
    if (operationRevision !== editRevisionRef.current) {
      setMessage("文章已发生新编辑，请保存后刷新配图结果");
      return;
    }
    setImageAssets(assets);
    markPersisted(nextArticle);
  }

  // 第三步生成/修订分镜时，帧资产由服务端直接落库，客户端的资产列表会落后一拍
  //（旧流程靠第四步规划请求的响应带回资产；规划面板退场后这条补给线没了）。
  const refreshImageAssetsFromServer = useCallback(async () => {
    try {
      const response = await fetch(`/api/articles/${articleRef.current.id}/image-assets`);
      if (!response.ok) return;
      const body = (await response.json()) as { assets?: ImageAsset[] };
      if (Array.isArray(body.assets)) setImageAssets(body.assets);
    } catch {
      // 拉取失败保持现状：之后的图片操作响应仍会带回完整资产。
    }
  }, []);

  // 进入第四步时对齐一次资产列表（分镜文章才有帧资产；旧文跳过，避免多余请求）。
  useEffect(() => {
    if (activeStep !== "images") return;
    if (!articleRef.current.planning.storyboardSegments?.length) return;
    void refreshImageAssetsFromServer();
  }, [activeStep, refreshImageAssetsFromServer]);

  const handleContentHistoryChange = useCallback((
    versions: ArticleRevision<ContentRevisionSnapshot>[],
    review: ContentWorkspaceReview,
    versionReviews: ContentVersionReviews
  ) => {
    setContentVersions(versions);
    setContentReview(review);
    setContentVersionReviews(versionReviews);
  }, []);

  const saveLabel = {
    saved: "已保存",
    saving: "保存中",
    conflict: "存在冲突",
    error: "未保存"
  }[saveState];

  // 第三步设计过分镜的文章（planning.storyboardSegments 非空）：
  // 第四步走「帧生成 + 分段拼接」，视觉规划面板整体退场。
  const hasStoryboardSegments = Boolean(article.planning.storyboardSegments?.length);

  return (
    <section className="workspace-page" aria-labelledby="article-title">
      <header className="workspace-toolbar">
        <div className="workspace-title-wrap">
          <p className="eyebrow">图文工作台</p>
          <h1 id="article-title">{article.title}</h1>
        </div>
        <div className="toolbar-actions">
          <span className={`save-state save-state-${saveState}`}>
            <Save size={14} aria-hidden="true" />
            {saveLabel}
          </span>
          {article.status === "content_ready" ? (
            <button
              className="button button-secondary"
              type="button"
              disabled={isSettingPublishStatus}
              onClick={() => void handleSetPublishStatus("ready_to_publish")}
            >
              <Send size={16} aria-hidden="true" />
              {isSettingPublishStatus ? "标记中..." : "标记为待发布"}
            </button>
          ) : null}
          {article.status === "ready_to_publish" ? (
            <>
              <span className="publish-badge" role="status">
                <Send size={14} aria-hidden="true" />
                待发布
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={isSettingPublishStatus}
                onClick={() => void handleSetPublishStatus("content_ready")}
              >
                <Undo2 size={16} aria-hidden="true" />
                撤回待发布
              </button>
            </>
          ) : null}
          <button
            className="button button-secondary"
            type="button"
            disabled={!article.blocks.length}
            onClick={() => setIsPreviewOpen(true)}
          >
            <Eye size={16} aria-hidden="true" />
            预览
          </button>
        </div>
      </header>

      {message ? <div className="workspace-alert" role="alert">{message}</div> : null}

      <div className="workflow-progress-band">
        <WorkflowStepper steps={steps} onSelect={selectStep} />
      </div>

      <main className="workflow-operation" aria-live="polite">
        {activeStep === "sources" ? (
          <section className="workflow-panel workflow-sources-panel">
            <SourcePanel articleId={article.id} article={article} sources={sources} readOnly={isNarrowViewport} onChange={adoptSourceMutation} />
            <KnowledgeBriefEditor
              brief={article.brief}
              readOnly={isNarrowViewport}
              onChange={(brief) => updateArticle({
                brief,
                blocks: [],
                planning: {
                  ...articleRef.current.planning,
                  confirmedOutlineRevisionId: null,
                  contentOutlineRevisionId: null
                },
                outlineConfirmedAt: null,
                status: "brief_ready"
              })}
            />
          </section>
        ) : null}
        {activeStep === "outline" ? (
          <OutlineWorkspace
            embedded
            initialArticle={article}
            initialSources={sources}
            initialVersions={outlineVersions}
            initialReview={outlineReview}
            initialVersionReviews={outlineVersionReviews}
            llmConfig={llmConfig}
            onSourcesChange={adoptSourceMutation}
            onOutlineHistoryChange={handleOutlineHistoryChange}
            onOutlineConfirmed={() => selectStep("article")}
            onArticleChange={(nextArticle, childIsDirty) => {
              articleRef.current = nextArticle;
              editRevisionRef.current += childIsDirty ? 1 : 0;
              setArticle(nextArticle);
              setIsDirty(childIsDirty);
              dirtyRef.current = childIsDirty;
              setAutosaveBlocked(false);
              setSaveState(childIsDirty ? "saving" : "saved");
            }}
          />
        ) : null}
        {activeStep === "article" ? (
          <section className="workflow-panel workflow-article-panel" aria-label="设计分镜">
            <ContentWorkspace
              article={article}
              sources={sources}
              imageAssets={imageAssets}
              initialVersions={contentVersions}
              initialReview={contentReview}
              initialVersionReviews={contentVersionReviews}
              llmConfig={llmConfig}
              readOnly={isNarrowViewport}
              prepareArticle={prepareArticle}
              onArticleChange={markPersisted}
              onContentApproved={() => selectStep("images")}
              onEditBlocks={updateBlocks}
              onEditPlanning={(patch) =>
                updateArticle({ planning: { ...articleRef.current.planning, ...patch } })
              }
              onHistoryChange={handleContentHistoryChange}
              generateContent={generateContent}
              reviseContent={reviseContent}
              reviewContent={reviewContent}
              approveContent={approveContent}
              saveVersion={saveContentVersion}
              restoreVersion={restoreContentVersion}
            />
          </section>
        ) : null}
        {activeStep === "images" ? (
          <section className="workflow-panel workflow-images-panel" aria-label="配图">
            {hasStoryboardSegments ? (
              // 第三步做过分镜设计的文章：第四步只负责把设计稿的帧出图 + 拼段图，
              // 不再提供「重新设计分镜」——视觉规划器的让位语义会删掉/停用第三步
              // 设计的帧，两套设计互相打架；服务端 planImages 对这类文章直接拒绝。
              // 旧文章没有 segments，保留整篇一条的漫画长图 + 视觉规划入口。
              <>
                <SegmentFramesPanel
                  article={article}
                  assets={imageAssets}
                  readOnly={isNarrowViewport}
                  disabled={isDirty || autosaveBlocked || saveState === "saving"}
                  onResult={applyImageResult}
                  planSettingsEnabled={imageGenerationEnabled}
                  updateAsset={(assetId, input) =>
                    beginImageOperation(() =>
                      updateImageAsset(articleRef.current.id, assetId, input)
                    )
                  }
                  refreshPlaceholder={(assetId, expectedUpdatedAt) =>
                    beginImageOperation(() =>
                      refreshPlaceholder(articleRef.current.id, assetId, expectedUpdatedAt)
                    )
                  }
                  selectGeneration={
                    selectImageGeneration
                      ? (assetId: string, generationId: string, expectedUpdatedAt: string) =>
                          beginImageOperation(() =>
                            selectImageGeneration(
                              articleRef.current.id,
                              assetId,
                              generationId,
                              expectedUpdatedAt
                            )
                          )
                      : undefined
                  }
                  generateImage={
                    imageGenerationEnabled
                      ? (assetId: string, expectedUpdatedAt: string, model?: string) =>
                          beginImageOperation(() =>
                            generateImage(articleRef.current.id, assetId, expectedUpdatedAt, model)
                          )
                      : undefined
                  }
                  generateBatch={
                    imageGenerationEnabled
                      ? ({ expectedUpdatedAt, model }: { expectedUpdatedAt: string; model?: string }) =>
                          beginImageOperation(() =>
                            generateBatch(articleRef.current.id, expectedUpdatedAt, model)
                          )
                      : undefined
                  }
                />
                <SegmentStripsControl
                  article={article}
                  assets={imageAssets}
                  readOnly={isNarrowViewport}
                  disabled={isDirty || autosaveBlocked || saveState === "saving"}
                  onResult={applyImageResult}
                  composeSegmentStrips={(expectedUpdatedAt, fontId, textScaleId) =>
                    beginImageOperation(() =>
                      composeSegmentStrips(
                        articleRef.current.id,
                        expectedUpdatedAt,
                        fontId,
                        textScaleId
                      )
                    )
                  }
                  removeSegmentStrips={(expectedUpdatedAt) =>
                    beginImageOperation(() =>
                      removeComicStrip(articleRef.current.id, expectedUpdatedAt)
                    )
                  }
                />
                {/* 封面是公众号草稿的头图，也是推送的硬门槛；分镜文章不会从视觉规划器
                    拿到封面（第四步锁定规划），所以在这里单独给一个配置入口。 */}
                <CoverPanel
                  article={article}
                  assets={imageAssets}
                  readOnly={isNarrowViewport}
                  disabled={isDirty || autosaveBlocked || saveState === "saving"}
                  onResult={applyImageResult}
                  imageGenerationEnabled={imageGenerationEnabled}
                  generateCover={
                    imageGenerationEnabled
                      ? (input) => beginImageOperation(() => generateCoverOperation(input))
                      : undefined
                  }
                  ensureCover={(expectedUpdatedAt, input) =>
                    beginImageOperation(() =>
                      ensureCover(articleRef.current.id, expectedUpdatedAt, input)
                    )
                  }
                  updateAsset={(assetId, input) =>
                    beginImageOperation(() =>
                      updateImageAsset(articleRef.current.id, assetId, input)
                    )
                  }
                  selectGeneration={
                    selectImageGeneration
                      ? (assetId, generationId, expectedUpdatedAt) =>
                          beginImageOperation(() =>
                            selectImageGeneration(
                              articleRef.current.id,
                              assetId,
                              generationId,
                              expectedUpdatedAt
                            )
                          )
                      : undefined
                  }
                />
              </>
            ) : (
              <ComicStripControl
                article={article}
                assets={imageAssets}
                readOnly={isNarrowViewport}
                disabled={isDirty || autosaveBlocked || saveState === "saving"}
                onResult={applyImageResult}
                composeComicStrip={(expectedUpdatedAt) =>
                  beginImageOperation(() =>
                    composeComicStrip(articleRef.current.id, expectedUpdatedAt)
                  )
                }
                removeComicStrip={(expectedUpdatedAt) =>
                  beginImageOperation(() =>
                    removeComicStrip(articleRef.current.id, expectedUpdatedAt)
                  )
                }
              />
            )}
            <div className="article-canvas">
              <BlockEditor blocks={article.blocks} onChange={updateBlocks} readOnly={isNarrowViewport} imageAssets={imageAssets} />
            </div>
            {/* 分镜文章不渲染视觉规划面板（含「重新设计分镜」入口），旧文保留原流程。 */}
            {!hasStoryboardSegments ? (
              <GenerationPanel
                article={article}
                imageAssets={imageAssets}
                readOnly={isNarrowViewport}
                imageOperationsLocked={isDirty || autosaveBlocked || saveState === "saving"}
                onImageResult={applyImageResult}
                planImages={(expectedUpdatedAt, model, options) =>
                  beginImageOperation(() =>
                    options
                      ? planImages(articleRef.current.id, expectedUpdatedAt, model, options)
                      : planImages(articleRef.current.id, expectedUpdatedAt, model)
                  )}
                llmEnabled={llmConfig.enabled}
                availableModels={llmConfig.availableModels}
                updateImageAsset={(assetId, input) => beginImageOperation(() => updateImageAsset(articleRef.current.id, assetId, input))}
                deleteImageAsset={(assetId, expectedUpdatedAt) => beginImageOperation(() => deleteImageAsset(articleRef.current.id, assetId, expectedUpdatedAt))}
                refreshPlaceholder={(assetId, expectedUpdatedAt) => beginImageOperation(() => refreshPlaceholder(articleRef.current.id, assetId, expectedUpdatedAt))}
                generateImage={
                  imageGenerationEnabled
                    ? (assetId: string, expectedUpdatedAt: string, model?: string) =>
                        beginImageOperation(() =>
                          generateImage(articleRef.current.id, assetId, expectedUpdatedAt, model)
                        )
                    : undefined
                }
                generateBatch={
                  imageGenerationEnabled
                    ? ({ expectedUpdatedAt, model }: { expectedUpdatedAt: string; model?: string }) =>
                        beginImageOperation(() =>
                          generateBatch(articleRef.current.id, expectedUpdatedAt, model)
                        )
                    : undefined
                }
                selectGeneration={(assetId, generationId, expectedUpdatedAt) =>
                  beginImageOperation(() =>
                    selectImageGeneration(articleRef.current.id, assetId, generationId, expectedUpdatedAt)
                  )
                }
                deleteGeneration={(generationId, expectedUpdatedAt) =>
                  beginImageOperation(() =>
                    deleteImageGeneration(articleRef.current.id, generationId, expectedUpdatedAt)
                  )
                }
              />
            ) : null}
          </section>
        ) : null}
      </main>

      {isPreviewOpen ? (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="公众号预览">
          <WechatPreview
            blocks={article.blocks}
            assets={imageAssets}
            stripFlow={hasStoryboardSegments}
            onClose={() => setIsPreviewOpen(false)}
            publishDraft={
              wechatPublishEnabled
                ? (themeId, force) => publishWechatRequest(articleRef.current.id, themeId, force)
                : undefined
            }
          />
        </div>
      ) : null}
    </section>
  );
}
