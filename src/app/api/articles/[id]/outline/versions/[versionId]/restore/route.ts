import { z } from "zod";
import { restoreOutlineVersion } from "@/features/outlines/restore-outline-version";
import type { OutlineWorkflowRepository } from "@/features/outlines/workflow-repository";
import { getOutlineWorkflowRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; versionId: string }>;
}

const restoreRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

export function createOutlineRestoreRouteHandler(workflow: OutlineWorkflowRepository) {
  return async function POST(request: Request, context: RouteContext) {
    const { id, versionId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = restoreRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "恢复版本请求无效" }, { status: 400 });
    const result = await restoreOutlineVersion(
      { articleId: id, versionId, expectedUpdatedAt: parsed.data.expectedUpdatedAt },
      { workflow }
    );
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "version_not_found") return Response.json({ error: "大纲版本不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineRestoreRouteHandler(getOutlineWorkflowRepository())(request, context);
}
