import { z } from "zod";
import {
  composeCoverFromFrames,
  type ComposeCoverFromFramesDependencies
} from "@/features/images/compose-cover-from-frames";
import { getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const composeCoverRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  /** 指定三张帧资产 id（左中右）；缺省按段落顺序取前三张已生成帧。 */
  assetIds: z.array(z.string().trim().min(1)).length(3).optional()
});

export function createComposeCoverRouteHandler(
  dependencies: ComposeCoverFromFramesDependencies
) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = composeCoverRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "封面拼接请求无效" }, { status: 400 });
    const result = await composeCoverFromFrames(
      { articleId: id, ...parsed.data },
      dependencies
    );
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") {
      return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    }
    if (result.kind === "not_enough_frames" || result.kind === "compose_error") {
      return Response.json(
        { error: result.message, ...(result.assets ? { article: result.article, assets: result.assets } : {}) },
        { status: 502 }
      );
    }
    return Response.json({ article: result.article, assets: result.assets });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createComposeCoverRouteHandler({
    images: getImageAssetRepository()
  })(request, context);
}
