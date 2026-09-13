import { z } from "zod";
import { approveContent, type ApproveContentDependencies } from "@/features/content/approve-content";
import {
  getArticleRepository,
  getContentWorkflowRepository,
  getSourceRepository
} from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const approveContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  acknowledgeWarnings: z.boolean().default(false)
});

export function createContentApproveRouteHandler(dependencies: ApproveContentDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = approveContentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "确认内容请求无效" }, { status: 400 });

    const result = await approveContent({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "not_ready") return Response.json({ error: "请先生成正文" }, { status: 400 });
    if (result.kind === "stale_outline") return Response.json({ error: "当前正文基于旧大纲，请先重新生成正文" }, { status: 400 });
    if (result.kind === "blocked") return Response.json({ error: "审核被阻断，请修改后重新审核" }, { status: 400 });
    if (result.kind === "acknowledgement_required") return Response.json({ error: "请先确认已了解审核警告" }, { status: 400 });
    return Response.json({ article: result.article, revision: result.revision, review: result.review });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createContentApproveRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    workflow: getContentWorkflowRepository()
  })(request, context);
}
