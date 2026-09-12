import { NewArticleForm } from "./new-article-form";

export default function NewArticlePage() {
  return (
    <section className="page-section narrow-page" aria-labelledby="new-title">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">新建文章</p>
          <h1 id="new-title">从一个知识点开始</h1>
        </div>
      </div>
      <NewArticleForm />
    </section>
  );
}

