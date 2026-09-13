"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockEditor } from "@/components/block-editor";
import { ContentReviewPanel } from "@/components/content-review-panel";
import { ModelSelect } from "@/components/model-select";
import { StyleProfileControl } from "@/components/style-profile-control";
import { VersionHistory } from "@/components/version-history";
import type { Article, ContentBlock } from "@/features/articles/domain";
import { textBlocksOf } from "@/features/content/content-version";
import type { ContentReviewResult } from "@/features/content/ports";
import type { StyleProfile } from "@/features/content/style-profile";
import type { ImageAsset } from "@/features/images/domain";
import type {
  ArticleReview,
  ArticleRevision,
  ContentRevisionSnapshot
} from "@/features/revisions/domain";
import type { SourceDocument } from "@/features/sources/domain";
import type { PublicLlmConfig } from "@/server/config";
import {
  contentReviewIsStale,
  reviewForContentVersion,
  type ContentVersionReviews,
  type ContentWorkspaceReview
} from "../content-state";

type ContentMutationResult = {
  article: Article;
  revision: ArticleRevision<ContentRevisionSnapshot>;
};

type ContentReviewMutationResult = {
  revision: ArticleRevision<ContentRevisionSnapshot>;
  review: ArticleReview<ContentReviewResult>;
};

type ApproveResult = ContentMutationResult & { review: ArticleReview<ContentReviewResult> | null };

export type GenerateContent = (input: {
  expectedUpdatedAt: string;
  model?: string;
  styleProfile: StyleProfile;
}) => Promise<ContentMutationResult>;

export type ReviewContent = (input: {
  expectedUpdatedAt: string;
  model?: string;
}) => Promise<ContentReviewMutationResult>;

export type ApproveContent = (input: {
  expectedUpdatedAt: string;
  acknowledgeWarnings: boolean;
}) => Promise<ApproveResult>;

export type SaveVersion = (input: { expectedUpdatedAt: string }) => Promise<ContentMutationResult>;
export type RestoreVersion = (versionId: string, expectedUpdatedAt: string) => Promise<ContentMutationResult>;

export interface ContentWorkspaceProps {
  article: Article;
  sources?: SourceDocument[];
  imageAssets?: ImageAsset[];
  initialVersions?: ArticleRevision<ContentRevisionSnapshot>[];
  initialReview?: ContentWorkspaceReview;
  initialVersionReviews?: ContentVersionReviews;
  llmConfig: PublicLlmConfig;
  readOnly?: boolean;
  /** 先落盘当前未保存的编辑，再返回服务端最新文章。 */
  prepareArticle: () => Promise<Article>;
  onArticleChange: (article: Article) => void;
  onEditBlocks: (blocks: ContentBlock[]) => void;
  onHistoryChange?: (
    versions: ArticleRevision<ContentRevisionSnapshot>[],
    review: ContentWorkspaceReview,
    versionReviews: ContentVersionReviews
  ) => void;
  generateContent?: GenerateContent;
  reviewContent?: ReviewContent;
  approveContent?: ApproveContent;
  saveVersion?: SaveVersion;
  restoreVersion?: RestoreVersion;
}

async function requestJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "正文操作失败，请稍后重试");
  return result;
}

function generateContentRequest(articleId: string): GenerateContent {
  return (input) => requestJson<ContentMutationResult>(`/api/articles/${articleId}/content/generate`, input);
}

function reviewContentRequest(articleId: string): ReviewContent {
  return (input) => requestJson<ContentReviewMutationResult>(`/api/articles/${articleId}/content/review`, input);
}

function approveContentRequest(articleId: string): ApproveContent {
  return (input) => requestJson<ApproveResult>(`/api/articles/${articleId}/content/approve`, input);
}

function saveVersionRequest(articleId: string): SaveVersion {
  return (input) => requestJson<ContentMutationResult>(`/api/articles/${articleId}/content/versions`, input);
}

function restoreVersionRequest(articleId: string): RestoreVersion {
  return (versionId, expectedUpdatedAt) => requestJson<ContentMutationResult>(
    `/api/articles/${articleId}/content/versions/${versionId}/restore`,
    { expectedUpdatedAt }
  );
}

function addVersion(
  versions: ArticleRevision<ContentRevisionSnapshot>[],
  revision: ArticleRevision<ContentRevisionSnapshot>
) {
  return [revision, ...versions.filter((version) => version.id !== revision.id)]
    .sort((left, right) => right.version - left.version);
}

export function ContentWorkspace({
  article,
  sources = [],
  imageAssets = [],
  initialVersions = [],
  initialReview = null,
  initialVersionReviews = {},
  llmConfig,
  readOnly = false,
  prepareArticle,
  onArticleChange,
  onEditBlocks,
  onHistoryChange,
  generateContent,
  reviewContent,
  approveContent,
  saveVersion,
  restoreVersion
}: ContentWorkspaceProps) {
  const [versions, setVersions] = useState(initialVersions);
  const [currentReview, setCurrentReview] = useState<ContentWorkspaceReview>(initialReview);
  const [versionReviews, setVersionReviews] = useState<ContentVersionReviews>(initialVersionReviews);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState(llmConfig.availableModels);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [model, setModel] = useState(
    llmConfig.enabled ? llmConfig.defaultModel ?? llmConfig.availableModels[0] ?? "" : ""
  );
  const [styleProfile, setStyleProfile] = useState<StyleProfile>(article.styleProfile);
  const [highlightedBlockIds, setHighlightedBlockIds] = useState<readonly string[]>([]);
  const [operation, setOperation] = useState<
    "idle" | "generating" | "reviewing" | "approving" | "saving" | "restoring"
  >("idle");
  const [message, setMessage] = useState("");

  const isBusy = operation !== "idle";
  const textBlocks = useMemo(() => textBlocksOf(article.blocks), [article.blocks]);
  const staleOutline = !(
    article.planning.confirmedOutlineRevisionId &&
    article.planning.contentOutlineRevisionId === article.planning.confirmedOutlineRevisionId
  );
  const reviewIsStale = contentReviewIsStale(article, sources, currentReview);
  const canGenerate = Boolean(
    article.brief &&
    article.outline.length > 0 &&
    article.outlineConfirmedAt &&
    article.planning.confirmedOutlineRevisionId &&
    article.planning.recommendedTotalWords !== null
  );
  const canReview = canGenerate && textBlocks.length > 0 && !staleOutline;
  const canSaveVersion = textBlocks.length > 0 && !staleOutline;
  const previewVersion = versions.find((version) => version.id === previewVersionId) ?? null;
  const isPreviewing = previewVersion !== null;
  const displayedBlocks = isPreviewing ? previewVersion.snapshot.textBlocks : textBlocks;
  const displayedReview = isPreviewing
    ? reviewForContentVersion(previewVersion, versions, versionReviews)
    : currentReview?.review ?? null;
  const approved = article.status === "content_ready" || article.status === "ready_to_publish";

  useEffect(() => {
    onHistoryChange?.(versions, currentReview, versionReviews);
  }, [versions, currentReview, versionReviews, onHistoryChange]);

  useEffect(() => {
    // 服务端刷新后以最新风格为准，但用户正在编辑时不覆盖。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStyleProfile((current) =>
      JSON.stringify(current) === JSON.stringify(article.styleProfile) ? current : article.styleProfile
    );
  }, [article.styleProfile]);

  function locateIssue(blockIds: string[]) {
    setHighlightedBlockIds(blockIds);
    const first = blockIds[0];
    if (first) {
      document.getElementById(`block-${first}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    window.setTimeout(() => setHighlightedBlockIds([]), 2_400);
  }

  const run = useCallback(async (
    action: () => Promise<void>,
    nextOperation: Exclude<typeof operation, "idle">
  ) => {
    setOperation(nextOperation);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "正文操作失败，请稍后重试");
    } finally {
      setOperation("idle");
    }
  }, []);

  async function refreshModels() {
    setIsRefreshingModels(true);
    setMessage("");
    try {
      const response = await fetch("/api/llm/models");
      const result = (await response.json()) as { models?: string[]; defaultModel?: string | null; error?: string };
      if (!response.ok || !result.models?.length) throw new Error(result.error ?? "没有发现可用模型");
      setAvailableModels(result.models);
      setModel((current) => result.models?.includes(current) ? current : result.defaultModel ?? result.models?.[0] ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新模型失败，请稍后重试");
    } finally {
      setIsRefreshingModels(false);
    }
  }

  function handleGenerate() {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await prepareArticle();
      const result = await (generateContent ?? generateContentRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        ...(model ? { model } : {}),
        styleProfile
      });
      onArticleChange(result.article);
      setVersions((items) => addVersion(items, result.revision));
      setCurrentReview(null);
    }, "generating");
  }

  function handleReview() {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await prepareArticle();
      // 审核不透传模型选择器的值：审核走服务端默认的 LLM_REVIEW_MODEL（打分类轻量模型），
      // 模型选择器面向正文生成等改写任务。
      const result = await (reviewContent ?? reviewContentRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt
      });
      setCurrentReview(result);
      setVersions((items) => addVersion(items, result.revision));
      setVersionReviews((items) => ({ ...items, [result.revision.id]: result.review }));
    }, "reviewing");
  }

  function handleApprove(acknowledgeWarnings: boolean) {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await prepareArticle();
      const result = await (approveContent ?? approveContentRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        acknowledgeWarnings
      });
      onArticleChange(result.article);
      setVersions((items) => addVersion(items, result.revision));
      // 未审核直接确认时 review 为 null：不显示审核结论，正文状态照常落库。
      setCurrentReview(result.review ? { revision: result.revision, review: result.review } : null);
    }, "approving");
  }

  function handleSaveVersion() {
    void run(async () => {
      const saved = await prepareArticle();
      const result = await (saveVersion ?? saveVersionRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt
      });
      onArticleChange(result.article);
      setVersions((items) => addVersion(items, result.revision));
    }, "saving");
  }

  function handleRestore(versionId: string) {
    void run(async () => {
      const saved = await prepareArticle();
      const result = await (restoreVersion ?? restoreVersionRequest(saved.id))(versionId, saved.updatedAt);
      onArticleChange(result.article);
      setVersions((items) => addVersion(items, result.revision));
      setPreviewVersionId(null);
      setCurrentReview(null);
    }, "restoring");
  }

  return (
    <section className="content-workspace" aria-label="正文工作台">
      {message ? <div className="workspace-alert" role="alert">{message}</div> : null}

      <div className="content-workspace-grid">
        <aside className="content-outline-column" aria-label="已确认大纲">
          <h2 className="panel-label">已确认大纲</h2>
          {article.outline.length ? (
            <ol className="content-outline-list">
              {article.outline.map((section) => (
                <li key={section.id}>
                  <strong>{section.title}</strong>
                  {section.goal ? <span>{section.goal}</span> : null}
                </li>
              ))}
            </ol>
          ) : <p className="panel-empty">尚无大纲</p>}
        </aside>

        <main className="content-editor-column">
          <VersionHistory
            versions={versions}
            heading="正文版本"
            versionPrefix="正文"
            selectedVersionId={previewVersionId}
            disabled={isBusy}
            canSave={canSaveVersion && !isPreviewing}
            onSave={handleSaveVersion}
            onSelect={setPreviewVersionId}
          />

          {isPreviewing ? (
            <div className="outline-version-banner" role="status">
              <span>正在查看正文 v{previewVersion.version}</span>
              <div className="outline-version-banner-actions">
                <button className="button button-secondary" type="button" onClick={() => setPreviewVersionId(null)}>
                  返回当前草稿
                </button>
                <button className="button button-secondary" type="button" disabled={isBusy} onClick={() => handleRestore(previewVersion.id)}>
                  恢复为当前
                </button>
              </div>
            </div>
          ) : null}

          {staleOutline ? (
            <div className="workspace-alert" role="status">当前正文基于旧大纲，请先重新生成正文</div>
          ) : null}

          {displayedBlocks.length ? (
            <div className="article-canvas">
              <BlockEditor
                blocks={isPreviewing ? displayedBlocks : article.blocks}
                onChange={onEditBlocks}
                readOnly={readOnly || isPreviewing}
                imageAssets={imageAssets}
                highlightedBlockIds={isPreviewing ? [] : highlightedBlockIds}
              />
            </div>
          ) : (
            <p className="panel-empty">还没有正文。确认大纲后点击「生成完整正文」。</p>
          )}
        </main>

        <aside className="content-actions-column" aria-label="正文审核">
          <section className="content-generation-settings" aria-labelledby="content-generation-heading">
            <div className="outline-panel-heading">
              <div>
                <p className="panel-label">生成设置</p>
                <h2 id="content-generation-heading">正文生成</h2>
              </div>
            </div>
            <ModelSelect
              id="content-model"
              label="正文模型"
              enabled={llmConfig.enabled}
              availableModels={availableModels}
              value={model}
              disabled={isBusy || isPreviewing}
              refreshing={isRefreshingModels}
              onRefresh={() => void refreshModels()}
              onChange={setModel}
            />
            <StyleProfileControl
              value={styleProfile}
              disabled={isBusy || isPreviewing}
              onChange={setStyleProfile}
            />
            <button
              className="button button-primary content-generate-button"
              type="button"
              disabled={isBusy || isPreviewing || !canGenerate || readOnly}
              onClick={handleGenerate}
            >
              {operation === "generating" ? <RefreshCw size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
              {operation === "generating" ? "生成中..." : "生成完整正文"}
            </button>
          </section>

          <ContentReviewPanel
            review={displayedReview}
            actionReview={isPreviewing ? null : currentReview?.review ?? null}
            isStale={!isPreviewing && reviewIsStale}
            staleOutline={staleOutline}
            canReview={canReview && !readOnly}
            isReviewing={operation === "reviewing"}
            isApproving={operation === "approving"}
            approved={approved && !isPreviewing}
            disabled={isBusy}
            onReview={handleReview}
            onApprove={handleApprove}
            onLocateIssue={locateIssue}
          />
        </aside>
      </div>
    </section>
  );
}
