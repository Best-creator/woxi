import { z } from "zod";
import { reviewOutline, type ReviewOutlineDependencies } from "@/features/outlines/review-outline";
import { getArticleRepository, getOutlineReviewDefaultModel, getOutlineReviewer, getOutlineWorkflowRepository, getSourceRepository } from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const reviewRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional()
});

export function createOutlineReviewRouteHandler(dependencies: ReviewOutlineDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = reviewRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "大纲审核请求无效" }, { status: 400 });
    const result = await reviewOutline({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "no_outline") return Response.json({ error: "请先生成完整的大纲" }, { status: 400 });
    if (result.kind === "reviewer_error") return Response.json({ error: result.message }, { status: 502 });
    return Response.json({ revision: result.revision, review: result.review });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineReviewRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    reviewer: getOutlineReviewer(),
    workflow: getOutlineWorkflowRepository(),
    defaultModel: getOutlineReviewDefaultModel()
  })(request, context);
}
