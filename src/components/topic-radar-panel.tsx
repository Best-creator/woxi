"use client";

import { ChevronDown, PenLine, Radar, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RadarScoredItem, TopicRadarSnapshot } from "@/features/topic-radar/types";

/**
 * 首页「热点选题雷达」面板。
 * 默认折叠、展开时才首次抓取、之后只走手动刷新 —— E2E 与无网环境零外部网络依赖。
 */

type PanelPhase = "idle" | "loading" | "ready" | "error";

const RADAR_ITEM_LIMIT = 10;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildSourceDigest(item: RadarScoredItem): string {
  return [
    `**来源**：${item.source}`,
    `**链接**：${item.url}`,
    `**摘要**：${item.summary}`,
    `**入选原因**：${item.selectionReason}`,
    `**雷达建议**：${item.nextAction}`
  ].join("\n\n");
}

export function TopicRadarPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PanelPhase>("idle");
  const [snapshot, setSnapshot] = useState<TopicRadarSnapshot | null>(null);
  const [error, setError] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);

  async function load(refresh: boolean) {
    setPhase("loading");
    setError("");
    try {
      const response = await fetch(`/api/topic-radar${refresh ? "?refresh=1" : ""}`);
      const payload = (await response.json()) as TopicRadarSnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "热点选题抓取失败");
      }
      setSnapshot(payload);
      setPhase("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "热点选题抓取失败");
      setPhase("error");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !snapshot && phase !== "loading") {
      void load(false);
    }
  }

  async function startArticle(item: RadarScoredItem) {
    setCreatingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: item.title.slice(0, 120) })
      });
      const result = (await response.json()) as { article?: { id: string; updatedAt?: string }; error?: string };
      if (!response.ok || !result.article) {
        throw new Error(result.error ?? "创建文章失败");
      }
      // 资料摘要保存失败不阻断开文：文章已建，作者可在来源步骤手动补充。
      if (result.article.updatedAt) {
        await fetch(`/api/articles/${result.article.id}/sources`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: `选题雷达：${item.title}`.slice(0, 160),
            type: "markdown",
            content: buildSourceDigest(item),
            expectedUpdatedAt: result.article.updatedAt
          })
        }).catch(() => undefined);
      }
      router.push(`/articles/${result.article.id}?step=sources`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建文章失败");
      setCreatingId(null);
    }
  }

  const data = snapshot?.data ?? null;
  const metaText = snapshot
    ? snapshot.fresh
      ? `${formatDateTime(snapshot.data.generatedAt)} 实时抓取 · ${snapshot.data.itemCount} 条 · ${snapshot.data.sourceCount} 个来源`
      : `缓存于 ${formatDateTime(snapshot.cachedAt ?? snapshot.data.generatedAt)} · ${snapshot.data.itemCount} 条 · ${snapshot.data.sourceCount} 个来源`
    : "尚未抓取";
  const items = data ? data.topItems.slice(0, RADAR_ITEM_LIMIT) : [];

  return (
    <section className="topic-radar" aria-label="热点选题雷达">
      <button type="button" className="topic-radar-toggle" aria-expanded={open} onClick={toggle}>
        <Radar size={18} aria-hidden="true" />
        <span className="topic-radar-toggle-text">
          <span className="topic-radar-title">热点选题雷达</span>
          <span className="topic-radar-subtitle">抓取 AI / SaaS / 独立开发热点，一键开文</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={open ? "radar-chevron radar-chevron-open" : "radar-chevron"} />
      </button>

      {open ? (
        <div className="topic-radar-body">
          <div className="topic-radar-toolbar">
            <span className="topic-radar-meta">{metaText}</span>
            <button
              type="button"
              className="button button-secondary radar-refresh"
              onClick={() => void load(true)}
              disabled={phase === "loading"}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {phase === "loading" ? "抓取中..." : "重新抓取"}
            </button>
          </div>

          {error ? <p className="field-error">{error}</p> : null}

          {phase === "loading" && !data ? (
            <p className="radar-hint">正在抓取七路热点来源，约需 10-30 秒...</p>
          ) : null}

          {data && data.itemCount === 0 ? (
            <p className="radar-hint">本轮没有抓到任何条目，可能是网络受限，点击「重新抓取」再试。</p>
          ) : null}

          {data && data.itemCount > 0 ? (
            <ol className="radar-list">
              {items.map((item, index) => (
                <li key={item.id} className="radar-item">
                  <div className="radar-item-head">
                    <span className="radar-rank" aria-hidden="true">{index + 1}</span>
                    <a className="radar-title" href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                    <span className="radar-score" title={`信号 ${item.scoreBreakdown.signal} / 相关 ${item.scoreBreakdown.relevance} / 内容 ${item.scoreBreakdown.contentFit} / 商业 ${item.scoreBreakdown.business} / 新鲜 ${item.scoreBreakdown.recency}`}>
                      {item.score}
                    </span>
                  </div>
                  <p className="radar-meta">
                    <span className="radar-source">{item.source}</span>
                    <span className="radar-recommendation">{item.recommendation}</span>
                    {item.opportunity ? <span className="radar-opportunity">吐槽 → 机会</span> : null}
                  </p>
                  {item.tags.length ? (
                    <p className="radar-tags">
                      {item.tags.slice(0, 6).map((tag) => (
                        <span key={tag} className="radar-tag">{tag}</span>
                      ))}
                    </p>
                  ) : null}
                  <p className="radar-action">{item.nextAction}</p>
                  <div className="radar-item-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={creatingId !== null}
                      onClick={() => void startArticle(item)}
                    >
                      <PenLine size={14} aria-hidden="true" />
                      {creatingId === item.id ? "正在开文..." : "用这个选题开文"}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {data && data.itemCount > RADAR_ITEM_LIMIT ? (
            <p className="radar-hint">仅展示前 {RADAR_ITEM_LIMIT} 条，本轮共 {data.itemCount} 条。</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
