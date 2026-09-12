import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository, ImagePlanMutationResult } from "@/features/images/repository";
import { getArticleRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; assetId: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

function mutationResponse(result: ImagePlanMutationResult) {
  if (result.kind === "saved") {
    return Response.json({ article: result.article, assets: result.assets });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "图片资产不存在" }, { status: 404 });
  }
  if (result.kind === "invalid_state") {
    return Response.json({ error: result.message }, { status: 400 });
  }
  if (result.kind === "invalid_anchor") {
    return Response.json({ error: "图片锚点不存在" }, { status: 400 });
  }
  return Response.json({ error: result.message }, { status: 400 });
}

export function createImageAssetPlaceholderRouteHandler(
  _articles: ArticleRepository,
  images: ImageAssetRepository
) {
  return async function POST(request: Request, context: RouteContext) {
    const { id, assetId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const input = requestSchema.safeParse(body);
    if (!input.success) {
      return Response.json({ error: "文章版本信息无效" }, { status: 400 });
    }

    return mutationResponse(
      await images.refreshPlaceholder(id, assetId, input.data.expectedUpdatedAt)
    );
  };
}

export function POST(request: Request, context: RouteContext) {
  return createImageAssetPlaceholderRouteHandler(
    getArticleRepository(),
    getImageAssetRepository()
  )(request, context);
}
