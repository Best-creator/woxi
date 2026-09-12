import { z } from "zod";
import { reviewContent, type ReviewContentDependencies } from "@/features/content/review-content";
import {
  getArticleRepository,
  getContentDefaultModel,
  getContentReviewer,
  getContentWorkflowRepository,
  getSourceRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const reviewContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional()
});

export function createContentReviewRouteHandler(dependencies: ReviewContentDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = reviewContentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "正文审核请求无效" }, { status: 400 });

    const result = await reviewContent({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "not_ready") return Response.json({ error: "请先生成正文再审核" }, { status: 400 });
    if (result.kind === "stale_outline") return Response.json({ error: "当前正文基于旧大纲，请先重新生成正文" }, { status: 400 });
    if (result.kind === "reviewer_error") return Response.json({ error: result.message }, { status: 502 });
    return Response.json({ revision: result.revision, review: result.review });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createContentReviewRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    reviewer: getContentReviewer(),
    workflow: getContentWorkflowRepository(),
    defaultModel: getContentDefaultModel()
  })(request, context);
}
