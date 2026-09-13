"use client";

import { ArrowRight, BookOpen, Globe, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SubmitPhase = "idle" | "creating" | "researching";

export function NewArticleForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<"quick" | "source">("quick");
  const [useWebResearch, setUseWebResearch] = useState(true);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [createdArticleId, setCreatedArticleId] = useState<string | null>(null);
  const isSubmitting = phase !== "idle";

  function goToOutline(articleId: string) {
    router.push(`/articles/${articleId}?step=outline`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 联网资料失败后文章已创建：再次提交即跳过资料直接进入。
    if (createdArticleId) {
      goToOutline(createdArticleId);
      return;
    }

    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setError("请输入要讲解的知识点");
      return;
    }
    if (mode === "source" && (!sourceTitle.trim() || !sourceContent.trim())) {
      setError("请输入资料标题和内容");
      return;
    }

    setError("");
    setPhase("creating");
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: normalizedTopic })
      });
      const result = (await response.json()) as {
        article?: { id: string; updatedAt?: string };
        error?: string;
      };
      if (!response.ok || !result.article) {
        throw new Error(result.error ?? "创建文章失败");
      }
      if (mode === "source" && sourceTitle.trim() && sourceContent.trim()) {
        const sourceResponse = await fetch(
          `/api/articles/${result.article.id}/sources`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: sourceTitle.trim(),
              type: "markdown",
              content: sourceContent.trim()
            })
          }
        );
        if (!sourceResponse.ok) {
          const sourceResult = (await sourceResponse.json()) as { error?: string };
          throw new Error(sourceResult.error ?? "资料保存失败");
        }
      }
      if (mode === "quick" && useWebResearch) {
        setPhase("researching");
        const researchResponse = await fetch(
          `/api/articles/${result.article.id}/research`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedUpdatedAt: result.article.updatedAt
            })
          }
        );
        if (!researchResponse.ok) {
          const researchResult = (await researchResponse.json()) as { error?: string };
          setCreatedArticleId(result.article.id);
          setError(
            `联网搜集资料失败：${researchResult.error ?? "服务暂时不可用"}。文章已创建，可点击「跳过资料直接进入」。`
          );
          setPhase("idle");
          return;
        }
      }
      goToOutline(result.article.id);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "创建文章失败"
      );
      setPhase("idle");
    }
  }

  const submitLabel =
    phase === "creating"
      ? "正在创建..."
      : phase === "researching"
        ? "正在联网搜集资料..."
        : createdArticleId
          ? "跳过资料直接进入"
          : "创建文章";

  return (
    <form className="new-article-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="mode-fieldset">
        <legend>创作模式</legend>
        <div className="segmented-control">
          <button className={`segment ${mode === "quick" ? "segment-active" : ""}`} type="button" aria-pressed={mode === "quick"} onClick={() => setMode("quick")}>
            <Zap size={16} aria-hidden="true" />
            快速生成
          </button>
          <button
            className={`segment ${mode === "source" ? "segment-active" : ""}`}
            type="button"
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            <BookOpen size={16} aria-hidden="true" />
            添加资料
          </button>
        </div>
      </fieldset>

      <div className="form-field">
        <label htmlFor="topic">知识点</label>
        <textarea
          id="topic"
          name="topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="例如：为什么复利需要时间？"
          rows={3}
          aria-describedby={error ? "topic-error" : undefined}
          aria-invalid={Boolean(error)}
          autoFocus
        />
        {error ? <p className="field-error" id="topic-error">{error}</p> : null}
      </div>

      {mode === "quick" ? (
        <label className="web-research-toggle">
          <input
            type="checkbox"
            checked={useWebResearch}
            onChange={(event) => setUseWebResearch(event.target.checked)}
          />
          <Globe size={16} aria-hidden="true" />
          <span>创建后由 AI 联网搜集资料，生成的大纲会更贴合真实信息</span>
        </label>
      ) : null}

      {mode === "source" ? (
        <div className="source-input-fields">
          <div className="form-field">
            <label htmlFor="source-title">资料标题</label>
            <input id="source-title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="例如：课堂笔记" />
          </div>
          <div className="form-field">
            <label htmlFor="source-content">资料内容</label>
            <textarea id="source-content" value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} placeholder="粘贴 TXT 或 Markdown 内容" rows={6} />
          </div>
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={isSubmitting}>
          {submitLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
