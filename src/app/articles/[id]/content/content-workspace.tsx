"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockEditor } from "@/components/block-editor";
import { ContentReviewPanel } from "@/components/content-review-panel";
import { ModelSelect } from "@/components/model-select";
import { StyleProfileControl } from "@/components/style-profile-control";
import { VersionHistory } from "@/components/version-history";
import { StoryboardSegmentList } from "@/components/storyboard-segment-list";
import type {
  Article,
  ArticlePlanning,
  ContentBlock,
  StoryboardRoute
} from "@/features/articles/domain";
import { textBlocksOf } from "@/features/content/content-version";
import type { ContentReviewResult } from "@/features/content/ports";
import type { StyleProfile } from "@/features/content/style-profile";
import { withStripsRestored } from "@/features/images/consumed-content";
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
  /** 正文确认成功后触发：工作台借此自动进入下一步（配图）。 */
  onContentApproved?: () => void;
  onEditBlocks: (blocks: ContentBlock[]) => void;
  /**
   * 分镜设计相关的 planning 局部修改（路由覆盖、分段重排等）。
   * 由工作台合并进当前 planning 后走统一的脏标记 + 自动保存 + 乐观锁。
   */
  onEditPlanning?: (patch: Partial<ArticlePlanning>) => void;
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
  onContentApproved,
  onEditBlocks,
  onEditPlanning,
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
  // 审核模型独立于生成模型：默认空值走服务端 LLM_REVIEW_MODEL（快模型）。
  const [reviewModel, setReviewModel] = useState("");
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
  // 分镜设计视图（第三步中栏）：正文按段拆卡渲染。拼过段图后 copyBlockIds 指向的块
  // 已从 article.blocks 消失，必须先在 withStripsRestored 的还原视图上解析；
  // 字数统计同源，避免拼图后字数突然塌掉。审核/存版本的门禁仍读原始 blocks——
  // 段图挂着时正文在库里的形态是「被替换后的」，不该再对它做审核或快照。
  const segments = useMemo(
    () =>
      [...(article.planning.storyboardSegments ?? [])].sort(
        (left, right) => left.order - right.order
      ),
    [article.planning.storyboardSegments]
  );
  const hasSegments = segments.length > 0;
  const stripsComposed = useMemo(
    () => imageAssets.some((asset) => asset.type === "comic_strip"),
    [imageAssets]
  );
  const restoredBlocks = useMemo(
    () => withStripsRestored(article.blocks, imageAssets),
    [article.blocks, imageAssets]
  );
  const restoredTextBlocks = useMemo(() => textBlocksOf(restoredBlocks), [restoredBlocks]);
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
  // 字数与中栏展示走还原视图（见上）；历史版本预览仍读版本快照本身。
  const displayedBlocks = isPreviewing ? previewVersion.snapshot.textBlocks : restoredTextBlocks;
  const displayedReview = isPreviewing
    ? reviewForContentVersion(previewVersion, versions, versionReviews)
    : currentReview?.review ?? null;
  const approved = article.status === "content_ready" || article.status === "ready_to_publish";

  // 正文字数统计：剔除图片块与空白字符，跟随编辑与版本预览实时更新。
  const wordStats = useMemo(() => {
    let characters = 0;
    let textBlockCount = 0;
    for (const block of displayedBlocks) {
      if (block.type === "image") continue;
      characters += block.content.replace(/\s/g, "").length;
      textBlockCount += 1;
    }
    return { characters, textBlockCount };
  }, [displayedBlocks]);
  const targetWords = article.planning.recommendedTotalWords;
  const wordDeviation = targetWords && targetWords > 0
    ? Math.round(((wordStats.characters - targetWords) / targetWords) * 100)
    : null;

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

  /** 段卡里的排法下拉：只改 planning 的路由字段，不碰正文块，也不受段图锁定影响。 */
  function handleRouteChange(segmentId: string, route: StoryboardRoute) {
    onEditPlanning?.({
      storyboardSegments: segments.map((segment) =>
        segment.id === segmentId ? { ...segment, route } : segment
      )
    });
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
      // 审核模型可选：面板下拉选「默认」时不透传，走服务端 LLM_REVIEW_MODEL；
      // 选了具体模型则用用户的选择（每个流程都可切换）。
      const result = await (reviewContent ?? reviewContentRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        ...(reviewModel ? { model: reviewModel } : {})
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
      onContentApproved?.();
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
            <>
              <p className="content-word-count" role="status" aria-label="正文字数统计">
                正文约 <strong>{wordStats.characters}</strong> 字 · {wordStats.textBlockCount} 个内容块
                {targetWords ? <> · 目标约 {targetWords} 字</> : null}
                {wordDeviation !== null && Math.abs(wordDeviation) > 15 ? (
                  <span className={wordDeviation > 0 ? "word-count-over" : "word-count-under"}>
                    （{wordDeviation > 0 ? "超出" : "还差"} {Math.abs(wordDeviation)}%）
                  </span>
                ) : null}
                {isPreviewing ? " · 当前为历史版本" : null}
              </p>
              {hasSegments && !isPreviewing ? (
                // 设计视图：按分镜段拆卡渲染，块取自还原视图（段图烘走的文案要放回来才能编辑）。
                <StoryboardSegmentList
                  segments={segments}
                  blocks={restoredBlocks}
                  imageAssets={imageAssets}
                  stripsComposed={stripsComposed}
                  readOnly={readOnly}
                  onEditBlocks={onEditBlocks}
                  onRouteChange={handleRouteChange}
                />
              ) : (
                <div className="article-canvas">
                  {!isPreviewing && !hasSegments ? <h2 className="panel-label">未分段文案</h2> : null}
                  <BlockEditor
                    blocks={isPreviewing ? displayedBlocks : article.blocks}
                    onChange={onEditBlocks}
                    readOnly={readOnly || isPreviewing}
                    imageAssets={imageAssets}
                    highlightedBlockIds={isPreviewing ? [] : highlightedBlockIds}
                  />
                  {!isPreviewing && !hasSegments ? (
                    // 旧文兼容：一律用新 UI。没有 segments 的文章给出明确指引而不是静默装作没事。
                    <aside className="storyboard-empty-guide" role="note">
                      <strong>这篇正文还没有分镜设计</strong>
                      <span>
                        点击右侧「生成完整正文」重新生成，正文会按大纲章节自动分成一个个分镜段；
                        之后在第四步即可按段拼接成段图。
                      </span>
                    </aside>
                  ) : null}
                </div>
              )}
            </>
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
            modelSelect={{
              enabled: llmConfig.enabled,
              availableModels,
              value: reviewModel,
              onChange: setReviewModel
            }}
            onReview={handleReview}
            onApprove={handleApprove}
            onLocateIssue={locateIssue}
          />
        </aside>
      </div>
    </section>
  );
}
