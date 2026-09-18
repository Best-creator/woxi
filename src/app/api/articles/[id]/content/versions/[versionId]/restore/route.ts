import { z } from "zod";
import {
  restoreContentVersion,
  type RestoreContentVersionDependencies
} from "@/features/content/restore-content-version";
import { getContentWorkflowRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; versionId: string }>;
}

const restoreRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

export function createContentRestoreRouteHandler(dependencies: RestoreContentVersionDependencies) {
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

    const result = await restoreContentVersion(
      { articleId: id, versionId, expectedUpdatedAt: parsed.data.expectedUpdatedAt },
      dependencies
    );
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "version_not_found") return Response.json({ error: "正文版本不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "storyboard_conflict") return Response.json({ error: result.message }, { status: 409 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createContentRestoreRouteHandler({
    workflow: getContentWorkflowRepository(),
    images: getImageAssetRepository()
  })(request, context);
}
