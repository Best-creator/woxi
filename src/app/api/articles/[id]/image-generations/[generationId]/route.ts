import { z } from "zod";
import { removeGenerationFile } from "@/features/images/generation-files";
import type { ImageAssetRepository, ImageGenerationMutationResult } from "@/features/images/repository";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; generationId: string }>;
}

const deleteSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

function mutationResponse(result: ImageGenerationMutationResult) {
  if (result.kind === "saved") {
    return Response.json({ article: result.article, assets: result.assets });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "生成版本不存在" }, { status: 404 });
  }
  return Response.json({ error: result.message }, { status: 400 });
}

/**
 * 删除某一版生成结果。
 *
 * 先落库再删文件：数据库那条记录才是「这版还在不在」的唯一依据，
 * 顺序反过来会在删除文件成功、落库失败时留下指向空文件的版本。
 */
export function createImageGenerationRouteHandler(images: ImageAssetRepository) {
  return async function DELETE(request: Request, context: RouteContext) {
    const { id, generationId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const input = deleteSchema.safeParse(body);
    if (!input.success) {
      return Response.json({ error: "文章版本信息无效" }, { status: 400 });
    }

    const generation = await images.findGenerationById(generationId);
    if (!generation || generation.articleId !== id) {
      return Response.json({ error: "生成版本不存在" }, { status: 404 });
    }

    const result = await images.deleteGeneration(
      id,
      generation.assetId,
      generationId,
      input.data.expectedUpdatedAt
    );
    if (result.kind === "saved") await removeGenerationFile(result.removedFilePath);
    return mutationResponse(result);
  };
}

export function DELETE(request: Request, context: RouteContext) {
  return createImageGenerationRouteHandler(getImageAssetRepository())(request, context);
}
