import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import { readySourceContext } from "@/features/outlines/generate-outline";
import { resolveOutlineModel } from "@/features/outlines/model";
import type { OutlineWorkflowRepository } from "@/features/outlines/workflow-repository";
import type { SourceRepository } from "@/features/sources/repository";
import { getArticleRepository, getOutlineDefaultModel, getOutlineWorkflowRepository, getSourceRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const saveVersionRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

interface OutlineVersionsDependencies {
  articles: ArticleRepository;
  sources: SourceRepository;
  workflow: OutlineWorkflowRepository;
  defaultModel?: string;
}

export function createOutlineVersionsRouteHandlers(dependencies: OutlineVersionsDependencies) {
  return {
    async GET(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      const article = await dependencies.articles.findById(id);
      if (!article) return Response.json({ error: "文章不存在" }, { status: 404 });
      return Response.json({ versions: await dependencies.workflow.listOutlineVersions(id) });
    },
    async POST(request: Request, context: RouteContext) {
      const { id } = await context.params;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }
      const parsed = saveVersionRequestSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "保存版本请求无效" }, { status: 400 });
      const article = await dependencies.articles.findById(id);
      if (!article) return Response.json({ error: "文章不存在" }, { status: 404 });
      if (article.updatedAt !== parsed.data.expectedUpdatedAt) {
        return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      }
      if (!article.brief || article.outline.length === 0 || article.planning.recommendedTotalWords === null) {
        return Response.json({ error: "请先生成完整的大纲" }, { status: 400 });
      }
      const sourceContextSnapshot = readySourceContext(await dependencies.sources.list(article.id));
      const result = await dependencies.workflow.saveManualOutlineVersion({
        articleId: article.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        model: resolveOutlineModel(undefined, dependencies.defaultModel),
        title: article.title,
        brief: article.brief,
        outline: article.outline,
        lengthPreset: article.planning.lengthPreset,
        recommendedTotalWords: article.planning.recommendedTotalWords,
        sourceContextSnapshot,
        ...(article.planning.storyline ? { storyline: article.planning.storyline } : {})
      });
      if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
      if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      return Response.json({ article: result.article, revision: result.revision });
    }
  };
}

export function GET(request: Request, context: RouteContext) {
  return createOutlineVersionsRouteHandlers({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    workflow: getOutlineWorkflowRepository(),
    defaultModel: getOutlineDefaultModel()
  }).GET(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineVersionsRouteHandlers({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    workflow: getOutlineWorkflowRepository(),
    defaultModel: getOutlineDefaultModel()
  }).POST(request, context);
}
