"use client";

import { Eye, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlockEditor } from "@/components/block-editor";
import { GenerationPanel } from "@/components/generation-panel";
import type { ImageMutationPayload } from "@/components/image-planning-panel";
import { KnowledgeBriefEditor } from "@/components/knowledge-brief-editor";
import { SourcePanel } from "@/components/source-panel";
import { WechatPreview } from "@/components/wechat-preview";
import { WorkflowStepper } from "@/components/workflow-stepper";
import type { Article, ContentBlock } from "@/features/articles/domain";
import type { SaveArticleResult } from "@/features/articles/repository";
import type { ImageAsset } from "@/features/images/domain";
import type { ImageAssetPatch } from "@/features/images/repository";
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
  type SaveVersion
} from "./content/content-workspace";

type SaveArticle = (
  article: Article,
  expectedUpdatedAt: string
) => Promise<SaveArticleResult>;

type PlanImages = (articleId: string, expectedUpdatedAt: string, model?: string) => Promise<ImageMutationPayload>;
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

export interface ArticleWorkspaceProps {
  initialArticle: Article;
  initialSources?: SourceDocument[];
  initialImageAssets?: ImageAsset[];
  saveArticle?: SaveArticle;
  planImages?: PlanImages;
  updateImageAsset?: UpdateImageAsset;
  deleteImageAsset?: DeleteImageAsset;
  refreshPlaceholder?: DeleteImageAsset;
  generateImage?: DeleteImageAsset;
  /** 服务端配置了图片生成能力时为 true，控制生成入口显隐。 */
  imageGenerationEnabled?: boolean;
  autosaveDelayMs?: number;
  initialStep?: string | null;
  initialVersions?: ArticleRevision<OutlineRevisionSnapshot>[];
  initialReview?: OutlineWorkspaceReview;
  initialVersionReviews?: OutlineVersionReviews;
  initialContentVersions?: ArticleRevision<ContentRevisionSnapshot>[];
  initialContentReview?: ContentWorkspaceReview;
  initialContentVersionReviews?: ContentVersionReviews;
  generateContent?: GenerateContent;
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
    error?: string;
  };
  if (!response.ok || !result.article || !result.assets) {
    throw new Error(result.error ?? "配图操作失败，请稍后重试");
  }
  return { article: result.article, assets: result.assets };
}

function planImagesRequest(articleId: string, expectedUpdatedAt: string, model?: string) {
  return imageMutationRequest(`/api/articles/${articleId}/image-plan`, "POST", {
    expectedUpdatedAt,
    ...(model ? { model } : {})
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

function generateImageRequest(articleId: string, assetId: string, expectedUpdatedAt: string) {
  return imageMutationRequest(
    `/api/articles/${articleId}/image-assets/${assetId}/generate`,
    "POST",
    { expectedUpdatedAt }
  );
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
  imageGenerationEnabled = false,
  autosaveDelayMs = 2_000,
  initialStep = null,
  initialVersions = [],
  initialReview = null,
  initialVersionReviews = {},
  initialContentVersions = [],
  initialContentReview = null,
  initialContentVersionReviews = {},
  generateContent,
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
    return operation();
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
          <section className="workflow-panel workflow-article-panel" aria-label="正文文章">
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
              onHistoryChange={handleContentHistoryChange}
              generateContent={generateContent}
              reviewContent={reviewContent}
              approveContent={approveContent}
              saveVersion={saveContentVersion}
              restoreVersion={restoreContentVersion}
            />
          </section>
        ) : null}
        {activeStep === "images" ? (
          <section className="workflow-panel workflow-images-panel" aria-label="配图">
            <div className="article-canvas">
              <BlockEditor blocks={article.blocks} onChange={updateBlocks} readOnly={isNarrowViewport} imageAssets={imageAssets} />
            </div>
            <GenerationPanel
              article={article}
              imageAssets={imageAssets}
              readOnly={isNarrowViewport}
              imageOperationsLocked={isDirty || autosaveBlocked || saveState === "saving"}
              onImageResult={applyImageResult}
              planImages={(expectedUpdatedAt, model) =>
                beginImageOperation(() => planImages(articleRef.current.id, expectedUpdatedAt, model))}
              llmEnabled={llmConfig.enabled}
              availableModels={llmConfig.availableModels}
              updateImageAsset={(assetId, input) => beginImageOperation(() => updateImageAsset(articleRef.current.id, assetId, input))}
              deleteImageAsset={(assetId, expectedUpdatedAt) => beginImageOperation(() => deleteImageAsset(articleRef.current.id, assetId, expectedUpdatedAt))}
              refreshPlaceholder={(assetId, expectedUpdatedAt) => beginImageOperation(() => refreshPlaceholder(articleRef.current.id, assetId, expectedUpdatedAt))}
              generateImage={
                imageGenerationEnabled
                  ? (assetId, expectedUpdatedAt) =>
                      beginImageOperation(() => generateImage(articleRef.current.id, assetId, expectedUpdatedAt))
                  : undefined
              }
            />
          </section>
        ) : null}
      </main>

      {isPreviewOpen ? (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="公众号预览">
          <WechatPreview blocks={article.blocks} onClose={() => setIsPreviewOpen(false)} />
        </div>
      ) : null}
    </section>
  );
}
