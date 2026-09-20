import { Plus } from "lucide-react";
import Link from "next/link";
import { ArticleList } from "@/components/article-list";
import { TopicRadarPanel } from "@/components/topic-radar-panel";
import { getArticleRepository } from "@/server/services";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const articles = await getArticleRepository().list();

  return (
    <section className="page-section" aria-labelledby="workspace-title">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">创作项目</p>
          <h1 id="workspace-title">内容工作台</h1>
        </div>
        <Link className="button button-primary" href="/articles/new">
          <Plus size={16} aria-hidden="true" />
          新建文章
        </Link>
      </div>

      <TopicRadarPanel />

      <ArticleList articles={articles} />
    </section>
  );
}
