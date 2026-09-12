import { FileText } from "lucide-react";
import Link from "next/link";
import type { Article, ArticleStatus } from "@/features/articles/domain";

const statusLabels: Record<ArticleStatus, string> = {
  draft: "草稿",
  brief_ready: "知识已梳理",
  outline_ready: "大纲已确认",
  editing: "编辑中",
  content_ready: "内容已确认",
  ready_to_publish: "待发布"
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ArticleList({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <div className="empty-state">
        <FileText size={28} aria-hidden="true" />
        <h2>还没有文章</h2>
        <p>从一个知识点开始，建立第一份结构化图文草稿。</p>
        <Link className="button button-secondary" href="/articles/new">
          创建第一篇文章
        </Link>
      </div>
    );
  }

  return (
    <div className="article-table-wrap">
      <table className="article-table">
        <thead>
          <tr>
            <th>文章</th>
            <th>状态</th>
            <th>最近编辑</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => (
            <tr key={article.id}>
              <td>
                <Link className="article-title" href={`/articles/${article.id}`}>
                  {article.title}
                </Link>
                <span className="article-topic">{article.topic}</span>
              </td>
              <td>
                <span className={`status status-${article.status}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {statusLabels[article.status]}
                </span>
              </td>
              <td className="article-time">{formatUpdatedAt(article.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

