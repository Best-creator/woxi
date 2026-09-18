import { z } from "zod";
import type { EnsureCoverResult, ImageAssetRepository } from "@/features/images/repository";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 建封面槽位（幂等）：已有封面原样返回，没有就建一张待生成的封面。
 *
 * 只建槽位、不出图——出图走 `image-assets/:assetId/generate`，那条链路自带
 * generating 状态机、版本记录与超时自愈；在这里再造一套会和它打架。
 * 客户端的「创建并生成封面」是这两步的串联。
 */
export const ensureCoverSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  altText: z.string().trim().min(1).max(240).optional(),
  aspectRatio: z.enum(["cover", "landscape", "square", "portrait"]).optional()
});

function coverResponse(result: EnsureCoverResult) {
  if (result.kind === "ready") {
    return Response.json({
      article: result.article,
      assets: result.assets,
      asset: result.asset,
      created: result.created
    });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  return Response.json({ error: "文章不存在" }, { status: 404 });
}

export function createCoverRouteHandler(images: ImageAssetRepository) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const input = ensureCoverSchema.safeParse(body);
    if (!input.success) {
      return Response.json(
        { error: input.error.issues[0]?.message ?? "封面配置无效" },
        { status: 400 }
      );
    }

    const { expectedUpdatedAt, ...coverInput } = input.data;
    return coverResponse(await images.ensureCover(id, expectedUpdatedAt, coverInput));
  };
}

export function POST(request: Request, context: RouteContext) {
  return createCoverRouteHandler(getImageAssetRepository())(request, context);
}
