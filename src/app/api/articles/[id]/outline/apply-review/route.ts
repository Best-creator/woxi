import { z } from "zod";
import { applyOutlineReview, type ApplyOutlineReviewDependencies } from "@/features/outlines/apply-outline-review";
import { getArticleRepository, getOutlineDefaultModel, getOutlineGenerator, getOutlineWorkflowRepository, getSourceRepository } from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const applyReviewRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional()
});

export function createOutlineApplyReviewRouteHandler(dependencies: ApplyOutlineReviewDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = applyReviewRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "按审核意见修改大纲请求无效" }, { status: 400 });
    const result = await applyOutlineReview({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "no_outline") return Response.json({ error: "请先生成完整的大纲" }, { status: 400 });
    if (result.kind === "review_required") return Response.json({ error: "当前大纲尚未审核或审核已过期" }, { status: 400 });
    if (result.kind === "no_revision_needed") return Response.json({ error: "当前审核已通过，无需按意见修改大纲" }, { status: 400 });
    if (result.kind === "generator_error") return Response.json({ error: result.message }, { status: 502 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineApplyReviewRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    generator: getOutlineGenerator(),
    workflow: getOutlineWorkflowRepository(),
    defaultModel: getOutlineDefaultModel()
  })(request, context);
}
