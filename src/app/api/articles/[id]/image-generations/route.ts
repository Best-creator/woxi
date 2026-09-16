import type { ImageAssetRepository } from "@/features/images/repository";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 文章素材库：本文全部生成版本，最新在前。
 *
 * 前端靠这一份数据同时渲染「某张配图的版本条」和「跨槽位复用选图」，
 * 所以不按 assetId 过滤，避免两次请求拿到的顺序不一致。
 */
export function createImageGenerationsRouteHandler(images: ImageAssetRepository) {
  return async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;
    const generations = await images.listGenerations(id);
    return Response.json({ generations });
  };
}

export function GET(request: Request, context: RouteContext) {
  return createImageGenerationsRouteHandler(getImageAssetRepository())(request, context);
}
