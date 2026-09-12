import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { DemoContentGenerator, DemoContentReviewer } from "@/features/content/demo-content-agents";
import { generateContent } from "@/features/content/generate-content";
import { SqliteContentWorkflowRepository } from "@/features/content/sqlite-workflow-repository";
import { DEFAULT_STYLE_PROFILE, resolveStyleProfile } from "@/features/content/style-profile";
import { DemoOutlineGenerator, DemoOutlineReviewer } from "@/features/outlines/demo-outline-agents";
import { confirmOutline } from "@/features/outlines/confirm-outline";
import { generateOutline } from "@/features/outlines/generate-outline";
import { reviewOutline } from "@/features/outlines/review-outline";
import { SqliteOutlineWorkflowRepository } from "@/features/outlines/sqlite-workflow-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { createTestDatabase } from "./test-db";

export function contentFixture() {
  const db = createTestDatabase();
  const articles = new SqliteArticleRepository(db);
  const sources = new SqliteSourceRepository(db);
  const outlineWorkflow = new SqliteOutlineWorkflowRepository(db);
  const contentWorkflow = new SqliteContentWorkflowRepository(db);
  return { db, articles, sources, outlineWorkflow, contentWorkflow };
}

/** 走完资料 → 大纲 → 审核 → 确认，得到可以生成正文的文章。 */
export async function articleWithConfirmedOutline() {
  const fixture = contentFixture();
  const created = await fixture.articles.create({ topic: "机会成本" });
  const generated = await generateOutline(
    { articleId: created.id, expectedUpdatedAt: created.updatedAt, lengthPreset: "standard" },
    {
      articles: fixture.articles,
      sources: fixture.sources,
      generator: new DemoOutlineGenerator(),
      workflow: fixture.outlineWorkflow
    }
  );
  if (generated.kind !== "generated") throw new Error("fixture should generate an outline");
  await reviewOutline(
    { articleId: generated.article.id, expectedUpdatedAt: generated.article.updatedAt },
    {
      articles: fixture.articles,
      sources: fixture.sources,
      reviewer: new DemoOutlineReviewer(),
      workflow: fixture.outlineWorkflow
    }
  );
  const confirmed = await confirmOutline(
    { articleId: generated.article.id, expectedUpdatedAt: generated.article.updatedAt, acknowledgeWarnings: true },
    { articles: fixture.articles, sources: fixture.sources, workflow: fixture.outlineWorkflow }
  );
  if (confirmed.kind !== "confirmed") throw new Error("fixture should confirm the outline");
  return { ...fixture, article: confirmed.article, outlineRevision: confirmed.revision };
}

/** 在已确认大纲之上生成一版正文。 */
export async function articleWithGeneratedContent() {
  const fixture = await articleWithConfirmedOutline();
  const generated = await generateContent(
    {
      articleId: fixture.article.id,
      expectedUpdatedAt: fixture.article.updatedAt,
      styleProfile: resolveStyleProfile("popular_science_teacher")
    },
    {
      articles: fixture.articles,
      sources: fixture.sources,
      generator: new DemoContentGenerator(),
      workflow: fixture.contentWorkflow
    }
  );
  if (generated.kind !== "generated") throw new Error("fixture should generate content");
  return {
    ...fixture,
    article: generated.article,
    contentRevision: generated.revision,
    reviewer: new DemoContentReviewer(),
    generator: new DemoContentGenerator(),
    styleProfile: DEFAULT_STYLE_PROFILE
  };
}
