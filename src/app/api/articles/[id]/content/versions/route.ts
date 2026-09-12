import { z } from "zod";
import { saveContentVersion, type SaveContentVersionDependencies } from "@/features/content/restore-content-version";
import {
  getArticleRepository,
  getContentDefaultModel,
  getContentWorkflowRepository,
  getSourceRepository
} from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const saveContentVersionRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

export function createContentVersionsRouteHandlers(dependencies: SaveContentVersionDependencies) {
  return {
    async GET(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      const article = await dependencies.articles.findById(id);
      if (!article) return Response.json({ error: "文章不存在" }, { status: 404 });
      return Response.json({ versions: await dependencies.workflow.listContentVersions(id) });
    },
    async POST(request: Request, context: RouteContext) {
      const { id } = await context.params;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }
      const parsed = saveContentVersionRequestSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "保存版本请求无效" }, { status: 400 });

      const result = await saveContentVersion(
        { articleId: id, expectedUpdatedAt: parsed.data.expectedUpdatedAt },
        dependencies
      );
      if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
      if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      if (result.kind === "not_ready") return Response.json({ error: "请先生成正文" }, { status: 400 });
      return Response.json({ article: result.article, revision: result.revision });
    }
  };
}

function defaultDependencies() {
  return {
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    workflow: getContentWorkflowRepository(),
    defaultModel: getContentDefaultModel()
  };
}

export function GET(request: Request, context: RouteContext) {
  return createContentVersionsRouteHandlers(defaultDependencies()).GET(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return createContentVersionsRouteHandlers(defaultDependencies()).POST(request, context);
}
