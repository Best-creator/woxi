"use client";

import { ArrowRight, BookOpen, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function NewArticleForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<"quick" | "source">("quick");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: normalizedTopic })
      });
      const result = (await response.json()) as {
        article?: { id: string };
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
      router.push(`/articles/${result.article.id}?step=outline`);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "创建文章失败"
      );
      setIsSubmitting(false);
    }
  }

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
          {isSubmitting ? "正在创建..." : "创建文章"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
