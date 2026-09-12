import { z } from "zod";
import { confirmOutline, type ConfirmOutlineDependencies } from "@/features/outlines/confirm-outline";
import { getArticleRepository, getOutlineWorkflowRepository, getSourceRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const confirmRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  acknowledgeWarnings: z.boolean().default(false)
});

export function createOutlineConfirmRouteHandler(dependencies: ConfirmOutlineDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = confirmRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "大纲确认请求无效" }, { status: 400 });
    const result = await confirmOutline({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "no_outline") return Response.json({ error: "请先生成完整的大纲" }, { status: 400 });
    if (result.kind === "review_required") return Response.json({ error: "当前大纲尚未审核或审核已过期" }, { status: 400 });
    if (result.kind === "blocked") return Response.json({ error: "审核已阻断确认，请先修订大纲" }, { status: 400 });
    if (result.kind === "acknowledgement_required") return Response.json({ error: "请显式确认忽略审核警告" }, { status: 400 });
    return Response.json({ article: result.article, revision: result.revision, review: result.review });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineConfirmRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    workflow: getOutlineWorkflowRepository()
  })(request, context);
}
