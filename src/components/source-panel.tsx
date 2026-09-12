"use client";

import { FileText, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { SourceDocument, SourceType } from "@/features/sources/domain";
import type { Article } from "@/features/articles/domain";

type CreateSourceInput = { title: string; type: SourceType; content: string };
type SourceMutation = { article: Article; source?: SourceDocument };
type LegacySourceMutation = { source?: SourceDocument };
type SourceMutationResult = SourceMutation | LegacySourceMutation | SourceDocument | void;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(result?.error ?? "资料操作失败");
  }
  return result as T;
}

export interface SourcePanelProps {
  articleId: string;
  sources: SourceDocument[];
  readOnly?: boolean;
  disabled?: boolean;
  article: Article;
  onChange: (sources: SourceDocument[], article: Article) => void;
  createSource?: (input: CreateSourceInput) => Promise<SourceMutationResult>;
  updateSource?: (sourceId: string, enabled: boolean) => Promise<SourceMutationResult>;
  deleteSource?: (sourceId: string) => Promise<SourceMutationResult>;
}

function invalidatedArticle(article: Article): Article {
  return {
    ...article,
    blocks: [],
    planning: {
      ...article.planning,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    },
    outlineConfirmedAt: null,
    status: article.brief ? "brief_ready" : "draft"
  };
}

function normalizeMutation(
  result: SourceMutationResult,
  article: Article,
  source?: SourceDocument
): SourceMutation {
  if (result && "article" in result) return result;
  return {
    article: invalidatedArticle(article),
    source: result && "source" in result
      ? result.source
      : result && "id" in result
        ? result
        : source
  };
}

export function SourcePanel({
  articleId,
  article,
  sources,
  readOnly = false,
  disabled = false,
  onChange,
  createSource,
  updateSource,
  deleteSource
}: SourcePanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SourceType>("markdown");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (!title.trim() || !content.trim()) {
      setError("请输入资料标题和内容");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      const input = {
        title: title.trim(),
        type,
        content: content.trim()
      };
      const result = normalizeMutation(
        createSource
          ? await createSource(input)
          : await requestJson<SourceMutation>(`/api/articles/${articleId}/sources`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...input, expectedUpdatedAt: article.updatedAt })
            }),
        article
      );
      if (!result.source) throw new Error("资料保存失败");
      onChange([result.source, ...sources], result.article);
      setTitle("");
      setContent("");
      setIsAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料操作失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function toggle(source: SourceDocument) {
    if (disabled) return;
    try {
      const result = normalizeMutation(
        updateSource
          ? await updateSource(source.id, !source.enabled)
          : await requestJson<SourceMutation>(`/api/articles/${articleId}/sources/${source.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled: !source.enabled, expectedUpdatedAt: article.updatedAt })
            }),
        article,
        { ...source, enabled: !source.enabled }
      );
      if (!result.source) throw new Error("资料操作失败");
      onChange(sources.map((item) => item.id === result.source?.id ? result.source : item), result.article);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料操作失败");
    }
  }

  async function remove(source: SourceDocument) {
    if (disabled) return;
    try {
      const result = normalizeMutation(
        deleteSource
          ? await deleteSource(source.id)
          : await requestJson<SourceMutation>(`/api/articles/${articleId}/sources/${source.id}`, {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ expectedUpdatedAt: article.updatedAt })
            }),
        article
      );
      onChange(sources.filter((item) => item.id !== source.id), result.article);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料操作失败");
    }
  }

  return (
    <section className="source-panel" aria-labelledby="source-panel-heading">
      <div className="source-panel-heading">
        <div>
          <p className="panel-label">参考资料</p>
          <h2 id="source-panel-heading">资料来源</h2>
        </div>
        {!readOnly ? (
          <button className="icon-button" type="button" onClick={() => setIsAdding((value) => !value)} aria-label={isAdding ? "取消添加资料" : "添加资料"} title={isAdding ? "取消" : "添加资料"} disabled={disabled}>
            {isAdding ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      {isAdding && !readOnly ? (
        <form className="source-form" onSubmit={handleCreate}>
          <label>
            <span>资料标题</span>
            <input aria-label="资料标题" value={title} disabled={disabled || isBusy} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>资料格式</span>
            <select aria-label="资料格式" value={type} disabled={disabled || isBusy} onChange={(event) => setType(event.target.value as SourceType)}>
              <option value="markdown">Markdown</option>
              <option value="text">纯文本</option>
              <option value="web">网页链接</option>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
            </select>
          </label>
          <label>
            <span>资料内容</span>
            <textarea aria-label="资料内容" rows={3} value={content} disabled={disabled || isBusy} onChange={(event) => setContent(event.target.value)} />
          </label>
          <button className="button button-primary" type="submit" disabled={disabled || isBusy}>保存资料</button>
        </form>
      ) : null}

      {sources.length ? (
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.id}>
              <FileText size={15} aria-hidden="true" />
              <div className="source-summary">
                <strong>{source.title}</strong>
                <span>{source.status === "ready" ? "可用" : "暂不支持"} · {source.type.toUpperCase()}</span>
              </div>
              {!readOnly ? (
                <span className="source-actions">
                  <label className="source-toggle">
                    <input type="checkbox" checked={source.enabled} disabled={disabled || isBusy || source.status !== "ready"} onChange={() => toggle(source)} aria-label={`启用${source.title}`} />
                  </label>
                  <button className="icon-button" type="button" onClick={() => remove(source)} aria-label={`删除${source.title}`} title="删除资料" disabled={disabled || isBusy}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="panel-empty">尚未添加资料</p>}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </section>
  );
}
