import { z } from "zod";
import type { ImageAssetRepository, ImageGenerationMutationResult } from "@/features/images/repository";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; assetId: string }>;
}

export const selectGenerationSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  generationId: z.string().trim().min(1).max(100)
});

function mutationResponse(result: ImageGenerationMutationResult) {
  if (result.kind === "saved") {
    return Response.json({ article: result.article, assets: result.assets });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "配图或生成版本不存在" }, { status: 404 });
  }
  return Response.json({ error: result.message }, { status: 400 });
}

/** 选用某张配图的某一版生成结果：切换 selected 并把该版镜像到正文里。 */
export function createImageAssetGenerationsRouteHandler(images: ImageAssetRepository) {
  return async function POST(request: Request, context: RouteContext) {
    const { id, assetId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const input = selectGenerationSchema.safeParse(body);
    if (!input.success) {
      return Response.json({ error: "选用的生成版本信息无效" }, { status: 400 });
    }
    return mutationResponse(
      await images.selectGeneration(id, assetId, input.data.generationId, input.data.expectedUpdatedAt)
    );
  };
}

export function POST(request: Request, context: RouteContext) {
  return createImageAssetGenerationsRouteHandler(getImageAssetRepository())(request, context);
}
