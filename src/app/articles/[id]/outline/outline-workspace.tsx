"use client";

import { RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KnowledgeBriefEditor } from "@/components/knowledge-brief-editor";
import { LengthPresetControl } from "@/components/length-preset-control";
import { ModelSelect } from "@/components/model-select";
import { OutlineNav } from "@/components/outline-nav";
import { OutlineReviewPanel } from "@/components/outline-review-panel";
import { SourcePanel } from "@/components/source-panel";
import { VersionHistory } from "@/components/version-history";
import type { Article, LengthPreset } from "@/features/articles/domain";
import type { SaveArticleResult } from "@/features/articles/repository";
import { reviewForOutlineVersion, type OutlineVersionReviews } from "../outline-state";
import type { OutlineReviewResult } from "@/features/outlines/domain";
import type { ArticleReview, ArticleRevision, OutlineRevisionSnapshot } from "@/features/revisions/domain";
import type { PublicLlmConfig } from "@/server/config";
import type { SourceDocument } from "@/features/sources/domain";

type WorkflowResult = {
  article: Article;
  revision: ArticleRevision<OutlineRevisionSnapshot>;
};

type ReviewResult = {
  revision: ArticleRevision<OutlineRevisionSnapshot>;
  review: ArticleReview<OutlineReviewResult>;
};

type CurrentReview = ReviewResult | null;

type GenerateOutline = (input: {
  expectedUpdatedAt: string;
  model?: string;
  lengthPreset: LengthPreset;
}) => Promise<WorkflowResult>;

type ReviewOutline = (input: { expectedUpdatedAt: string; model?: string }) => Promise<ReviewResult>;
type ApplyReview = (input: {
  expectedUpdatedAt: string;
  model?: string;
  /** 只按审核意见改时不传；用户自己写了要求时一并透传。 */
  userInstructions?: string;
}) => Promise<WorkflowResult>;
type ConfirmOutline = (input: { expectedUpdatedAt: string; acknowledgeWarnings: boolean }) => Promise<WorkflowResult>;
type SaveVersion = (input: { expectedUpdatedAt: string }) => Promise<WorkflowResult>;
type RestoreVersion = (versionId: string, expectedUpdatedAt: string) => Promise<WorkflowResult>;
type SaveArticle = (article: Article, expectedUpdatedAt: string) => Promise<SaveArticleResult>;

export interface OutlineWorkspaceProps {
  initialArticle: Article;
  initialSources?: SourceDocument[];
  initialVersions?: ArticleRevision<OutlineRevisionSnapshot>[];
  initialReview?: CurrentReview;
  initialVersionReviews?: OutlineVersionReviews;
  llmConfig: PublicLlmConfig;
  saveArticle?: SaveArticle;
  generateOutline?: GenerateOutline;
  reviewOutline?: ReviewOutline;
  applyReview?: ApplyReview;
  confirmOutline?: ConfirmOutline;
  saveVersion?: SaveVersion;
  restoreVersion?: RestoreVersion;
  embedded?: boolean;
  onArticleChange?: (article: Article, isDirty: boolean) => void;
  onOutlineConfirmed?: () => void;
  onSourcesChange?: (sources: SourceDocument[], article: Article) => void;
  onOutlineHistoryChange?: (
    versions: ArticleRevision<OutlineRevisionSnapshot>[],
    review: CurrentReview,
    versionReviews: OutlineVersionReviews
  ) => void;
}

function sourceContextSnapshot(sources: SourceDocument[]) {
  return sources
    .filter((source) => source.enabled && source.status === "ready")
    .map((source) => `【${source.title}】\n${source.content}`)
    .join("\n\n")
    .slice(0, 8_000);
}

function outlineReviewIsStale(article: Article, sources: SourceDocument[], review: CurrentReview) {
  if (!review) return false;
  const snapshot = review.revision.snapshot;
  return snapshot.title !== article.title
    || snapshot.lengthPreset !== article.planning.lengthPreset
    || snapshot.recommendedTotalWords !== article.planning.recommendedTotalWords
    || JSON.stringify(snapshot.brief) !== JSON.stringify(article.brief)
    || JSON.stringify(snapshot.outline) !== JSON.stringify(article.outline)
    || snapshot.sourceContextSnapshot !== sourceContextSnapshot(sources);
}

async function requestJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "大纲操作失败，请稍后重试");
  return result;
}

async function saveArticleRequest(article: Article, expectedUpdatedAt: string): Promise<SaveArticleResult> {
  const response = await fetch(`/api/articles/${article.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...article, expectedUpdatedAt })
  });
  if (response.status === 409) return { kind: "conflict" };
  const result = (await response.json()) as { article?: Article; error?: string };
  if (!response.ok || !result.article) throw new Error(result.error ?? "保存修改失败");
  return { kind: "saved", article: result.article };
}

function generateOutlineRequest(articleId: string): GenerateOutline {
  return (input) => requestJson<WorkflowResult>(`/api/articles/${articleId}/outline/generate`, input);
}

function reviewOutlineRequest(articleId: string): ReviewOutline {
  return (input) => requestJson<ReviewResult>(`/api/articles/${articleId}/outline/review`, input);
}

function applyReviewRequest(articleId: string): ApplyReview {
  return (input) => requestJson<WorkflowResult>(`/api/articles/${articleId}/outline/apply-review`, input);
}

function confirmOutlineRequest(articleId: string): ConfirmOutline {
  return (input) => requestJson<WorkflowResult>(`/api/articles/${articleId}/outline/confirm`, input);
}

function saveVersionRequest(articleId: string): SaveVersion {
  return (input) => requestJson<WorkflowResult>(`/api/articles/${articleId}/outline/versions`, input);
}

function restoreVersionRequest(articleId: string): RestoreVersion {
  return (versionId, expectedUpdatedAt) => requestJson<WorkflowResult>(
    `/api/articles/${articleId}/outline/versions/${versionId}/restore`,
    { expectedUpdatedAt }
  );
}

function addVersion(
  versions: ArticleRevision<OutlineRevisionSnapshot>[],
  revision: ArticleRevision<OutlineRevisionSnapshot>
) {
  return [revision, ...versions.filter((version) => version.id !== revision.id)]
    .sort((left, right) => right.version - left.version);
}

export function OutlineWorkspace({
  initialArticle,
  initialSources = [],
  initialVersions = [],
  initialReview = null,
  initialVersionReviews = {},
  llmConfig,
  saveArticle = saveArticleRequest,
  generateOutline,
  reviewOutline,
  applyReview,
  confirmOutline,
  saveVersion,
  restoreVersion,
  embedded = false,
  onArticleChange,
  onOutlineConfirmed,
  onSourcesChange,
  onOutlineHistoryChange
}: OutlineWorkspaceProps) {
  const [article, setArticle] = useState(initialArticle);
  const [sources, setSources] = useState(initialSources);
  const [versions, setVersions] = useState(initialVersions);
  const [currentReview, setCurrentReview] = useState<CurrentReview>(initialReview);
  const [versionReviews, setVersionReviews] = useState<OutlineVersionReviews>(initialVersionReviews);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState(llmConfig.availableModels);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  // 审核模型独立于生成模型：默认空值走服务端 LLM_REVIEW_MODEL（快模型）。
  const [reviewModel, setReviewModel] = useState("");
  // 「按审核意见改大纲」后旧审核必然失效（新大纲没有对应审核记录），需要显式标记；
  // 手动修改是否失效则实时比对当前草稿与审核快照——改回已审核的内容即自动恢复确认可用。
  const [reviewApplied, setReviewApplied] = useState(false);
  const [model, setModel] = useState(
    llmConfig.enabled ? llmConfig.defaultModel ?? llmConfig.availableModels[0] ?? "" : ""
  );
  const [lengthPreset, setLengthPreset] = useState<LengthPreset>(initialArticle.planning.lengthPreset);
  const [isDirty, setIsDirty] = useState(false);
  const [operation, setOperation] = useState<"idle" | "saving" | "generating" | "reviewing" | "applying" | "revising" | "confirming" | "restoring">("idle");
  const [message, setMessage] = useState("");
  // 「补充要求」输入框的内容：成功后清空，失败时保留，避免用户白打一遍。
  const [instructions, setInstructions] = useState("");
  const articleRef = useRef(article);

  const isBusy = operation !== "idle";
  const reviewIsStale = reviewApplied || (currentReview !== null && outlineReviewIsStale(article, sources, currentReview));
  const canReview = Boolean(article.brief && article.outline.length && article.planning.recommendedTotalWords !== null);
  const canSaveVersion = canReview;
  const previewVersion = versions.find((version) => version.id === previewVersionId) ?? null;
  const displayedBrief = previewVersion ? previewVersion.snapshot.brief : article.brief;
  const displayedOutline = previewVersion ? previewVersion.snapshot.outline : article.outline;
  const isPreviewing = previewVersion !== null;
  const displayedReview = isPreviewing
    ? reviewForOutlineVersion(previewVersion, versions, versionReviews)
    : currentReview?.review ?? null;

  function replaceArticle(nextArticle: Article) {
    articleRef.current = nextArticle;
    setArticle(nextArticle);
    setIsDirty(false);
    onArticleChange?.(nextArticle, false);
  }

  function changeArticle(changes: Partial<Article>) {
    const nextArticle = { ...articleRef.current, ...changes };
    articleRef.current = nextArticle;
    setArticle(nextArticle);
    setIsDirty(true);
    setMessage("");
    onArticleChange?.(nextArticle, true);
  }

  useEffect(() => {
    onOutlineHistoryChange?.(versions, currentReview, versionReviews);
  }, [versions, currentReview, versionReviews, onOutlineHistoryChange]);

  useEffect(() => {
    if (!isDirty || isBusy) return;
    const timer = window.setTimeout(() => {
      void persistChanges().catch((error) => {
        setMessage(error instanceof Error ? error.message : "自动保存失败，请稍后重试");
      });
    }, 800);
    return () => window.clearTimeout(timer);
  // The ref-backed save callback intentionally runs against the latest draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, isDirty, isBusy]);

  async function persistChanges() {
    const draft = articleRef.current;
    if (!isDirty) return draft;
    const result = await saveArticle(draft, draft.updatedAt);
    if (result.kind === "conflict") throw new Error("文章已在其他位置更新，请刷新后重试");
    replaceArticle(result.article);
    return result.article;
  }

  async function run(action: () => Promise<void>, nextOperation: Exclude<typeof operation, "idle">) {
    setOperation(nextOperation);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "大纲操作失败，请稍后重试");
    } finally {
      setOperation("idle");
    }
  }

  function handleSourcesChange(nextSources: SourceDocument[], nextArticle: Article) {
    setSources(nextSources);
    articleRef.current = nextArticle;
    setArticle(nextArticle);
    setIsDirty(false);
    onSourcesChange?.(nextSources, nextArticle);
    onArticleChange?.(nextArticle, false);
  }

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
      const saved = await persistChanges();
      const result = await (generateOutline ?? generateOutlineRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        ...(model ? { model } : {}),
        lengthPreset
      });
      replaceArticle(result.article);
      setLengthPreset(result.article.planning.lengthPreset);
      setVersions((items) => addVersion(items, result.revision));
      setCurrentReview(null);
      setPreviewVersionId(null);
      setReviewApplied(false);
    }, "generating");
  }

  function handleReview() {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await persistChanges();
      // 审核模型可选：面板下拉选「默认」时不透传，走服务端 LLM_REVIEW_MODEL；
      // 选了具体模型则用用户的选择（每个流程都可切换）。
      const result = await (reviewOutline ?? reviewOutlineRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        ...(reviewModel ? { model: reviewModel } : {})
      });
      setCurrentReview(result);
      setVersions((items) => addVersion(items, result.revision));
      setVersionReviews((items) => ({ ...items, [result.revision.id]: result.review }));
      setReviewApplied(false);
    }, "reviewing");
  }

  /**
   * 两个入口共用一条链路：不带 userInstructions 时是「按审核意见改」，带了就是「按我的意见改」。
   * 后者不要求必须先有审核记录，所以服务端的 review 闸门由 userInstructions 是否存在来决定。
   */
  function reviseOutline(userInstructions: string | undefined, nextOperation: "applying" | "revising") {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await persistChanges();
      const result = await (applyReview ?? applyReviewRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        ...(model ? { model } : {}),
        ...(userInstructions ? { userInstructions } : {})
      });
      replaceArticle(result.article);
      setLengthPreset(result.article.planning.lengthPreset);
      setVersions((items) => addVersion(items, result.revision));
      setCurrentReview(null);
      setPreviewVersionId(null);
      // 审核意见已应用：旧审核不再对应当前大纲，置为 stale 引导用户重新审核，
      // 否则面板清空后确认按钮灰着且没有任何下一步提示。
      setReviewApplied(true);
      if (userInstructions) setInstructions("");
    }, nextOperation);
  }

  function handleApplyReview() {
    // 面板在写了补充要求时会隐藏这个按钮；这里仍带上已输入的内容，任何调用方漏传都不会丢用户的话。
    reviseOutline(instructions.trim() || undefined, "applying");
  }

  function handleRevise() {
    const trimmed = instructions.trim();
    if (trimmed) reviseOutline(trimmed, "revising");
  }

  function handleConfirm(acknowledgeWarnings: boolean) {
    void run(async () => {
      setPreviewVersionId(null);
      const saved = await persistChanges();
      const result = await (confirmOutline ?? confirmOutlineRequest(saved.id))({
        expectedUpdatedAt: saved.updatedAt,
        acknowledgeWarnings
      });
      replaceArticle(result.article);
      setVersions((items) => addVersion(items, result.revision));
      setReviewApplied(false);
      onOutlineConfirmed?.();
    }, "confirming");
  }

  function handleSaveVersion() {
    void run(async () => {
      const saved = await persistChanges();
      const result = await (saveVersion ?? saveVersionRequest(saved.id))({ expectedUpdatedAt: saved.updatedAt });
      replaceArticle(result.article);
      setVersions((items) => addVersion(items, result.revision));
    }, "saving");
  }

  function handleRestore(versionId: string) {
    void run(async () => {
      const saved = await persistChanges();
      const result = await (restoreVersion ?? restoreVersionRequest(saved.id))(versionId, saved.updatedAt);
      replaceArticle(result.article);
      setVersions((items) => addVersion(items, result.revision));
      const restoredReview = reviewForOutlineVersion(
        versions.find((version) => version.id === versionId) ?? result.revision,
        versions,
        versionReviews
      );
      if (restoredReview) {
        setVersionReviews((items) => ({ ...items, [result.revision.id]: restoredReview }));
      }
      setCurrentReview(null);
      setPreviewVersionId(null);
      setReviewApplied(false);
    }, "restoring");
  }

  return (
    <section className={`outline-workspace${embedded ? " outline-workspace-embedded" : ""}`} aria-label="纲要工作台">
      {!embedded ? <header className="workspace-toolbar outline-workspace-toolbar">
        <div className="workspace-title-wrap">
          <p className="eyebrow">纲要工作台</p>
          <h1 id="outline-workspace-title">{article.title}</h1>
        </div>
        <div className="toolbar-actions">
          <span className="outline-save-state">{isDirty ? "有未保存修改" : "已保存"}</span>
          <button className="button button-secondary" type="button" disabled={!isDirty || isBusy} onClick={() => void run(async () => { await persistChanges(); }, "saving")}>
            <Save size={15} aria-hidden="true" />
            保存修改
          </button>
        </div>
      </header> : null}

      {message ? <div className="workspace-alert" role="alert">{message}</div> : null}

      <div className="outline-workspace-grid">
        <aside className="outline-sources-column" aria-label="资料来源">
          <SourcePanel articleId={article.id} article={article} sources={sources} disabled={isBusy || isPreviewing} onChange={handleSourcesChange} />
          <KnowledgeBriefEditor
            brief={displayedBrief}
            readOnly={isPreviewing}
            disabled={isBusy}
            onChange={(brief) => changeArticle({ brief, blocks: [], planning: { ...article.planning, confirmedOutlineRevisionId: null, contentOutlineRevisionId: null }, status: article.outline.length ? "brief_ready" : "draft", outlineConfirmedAt: null })}
          />
        </aside>

        <main className="outline-editor-column">
          <section className="outline-generation-settings" aria-labelledby="outline-generation-settings-heading">
            <div className="outline-generation-toolbar">
              <div className="outline-panel-heading">
                <div>
                  <p className="panel-label">生成设置</p>
                  <h2 id="outline-generation-settings-heading">理解与大纲</h2>
                </div>
              </div>
              <div className="outline-setting-fields">
                <ModelSelect enabled={llmConfig.enabled} availableModels={availableModels} value={model} disabled={isBusy || isPreviewing} refreshing={isRefreshingModels} onRefresh={() => void refreshModels()} onChange={setModel} />
                <LengthPresetControl value={lengthPreset} disabled={isBusy || isPreviewing} onChange={setLengthPreset} />
              </div>
              <button className="button button-primary outline-generate-button" type="button" disabled={isBusy || isPreviewing} onClick={handleGenerate}>
                {operation === "generating" ? <RefreshCw size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
                {operation === "generating" ? "生成中..." : "生成理解与大纲"}
              </button>
            </div>
          </section>

          <VersionHistory
            versions={versions}
            selectedVersionId={previewVersionId}
            disabled={isBusy}
            canSave={canSaveVersion && !isPreviewing}
            onSave={handleSaveVersion}
            onSelect={setPreviewVersionId}
          />

          {previewVersion ? (
            <div className="outline-version-banner" role="status">
              <span>正在查看大纲 v{previewVersion.version}</span>
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

          <section className="outline-editor" aria-labelledby="outline-editor-heading">
            <div className="outline-panel-heading">
              <div>
                <p className="panel-label">章节结构</p>
                <h2 id="outline-editor-heading">文章大纲</h2>
              </div>
              {(previewVersion?.snapshot.recommendedTotalWords ?? article.planning.recommendedTotalWords) !== null ? (
                <span className="recommended-words">建议 {previewVersion?.snapshot.recommendedTotalWords ?? article.planning.recommendedTotalWords} 字</span>
              ) : null}
            </div>
            <OutlineNav
              sections={displayedOutline}
              readOnly={isPreviewing}
              disabled={isBusy}
              onChange={(outline) => changeArticle({ outline, blocks: [], planning: { ...article.planning, confirmedOutlineRevisionId: null, contentOutlineRevisionId: null }, outlineConfirmedAt: null, status: article.brief ? "brief_ready" : "draft" })}
            />
          </section>
        </main>

        <aside className="outline-actions-column" aria-label="审核">
          <OutlineReviewPanel
            review={displayedReview}
            actionReview={currentReview?.review ?? null}
            isStale={reviewIsStale}
            canReview={canReview}
            isReviewing={operation === "reviewing"}
            isConfirming={operation === "confirming"}
            isApplyingReview={operation === "applying"}
            instructions={instructions}
            isRevising={operation === "revising"}
            onInstructionsChange={setInstructions}
            onRevise={handleRevise}
            confirmed={Boolean(article.outlineConfirmedAt)}
            disabled={isBusy}
            previewing={isPreviewing}
            modelSelect={{
              enabled: llmConfig.enabled,
              availableModels,
              value: reviewModel,
              onChange: setReviewModel
            }}
            onReview={handleReview}
            onConfirm={handleConfirm}
            onApplyReview={handleApplyReview}
          />
        </aside>
      </div>
    </section>
  );
}
