import { z } from "zod";
import {
  collectWebResearch,
  type CollectWebResearchDependencies
} from "@/features/research/collect-web-research";
import {
  getArticleRepository,
  getLlmJsonClient,
  getResearchDefaultModel,
  getSourceWorkflow,
  getWebSearch
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const researchRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional()
});

export function createResearchRouteHandler(dependencies: CollectWebResearchDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = researchRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "联网搜集资料请求无效" }, { status: 400 });

    const result = await collectWebResearch(
      { articleId: id, ...parsed.data },
      dependencies
    );
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") {
      return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    }
    if (result.kind === "error") return Response.json({ error: result.message }, { status: 502 });
    return Response.json({
      article: result.article,
      source: result.source,
      queries: result.queries,
      resultCount: result.resultCount
    });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createResearchRouteHandler({
    articles: getArticleRepository(),
    workflow: getSourceWorkflow(),
    webSearch: getWebSearch(),
    llm: getLlmJsonClient(),
    defaultModel: getResearchDefaultModel()
  })(request, context);
}
