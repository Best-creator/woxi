import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import {
  generateImageAsset,
  type GenerateImageAssetDependencies
} from "@/features/images/generate-image-asset";
import type { GenerationEnhancementDependencies } from "@/features/images/generation-enhancements";
import type { ImageGenerator } from "@/features/images/image-generator";
import { SqliteImagePlanSettingsRepository } from "@/features/images/plan-settings";
import type { ImageAssetRepository } from "@/features/images/repository";
import {
  getArticleRepository,
  getDatabase,
  getImageGenerator,
  getImageAssetRepository,
  getReferenceCharacterRepository,
  getStyleLibraryRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string; assetId: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).max(100).optional()
});

function generationResponse(result: Awaited<ReturnType<typeof generateImageAsset>>) {
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
  // 生成失败也落库过（帧置 failed、文章推进）：把最新状态随错误一起回传，
  // 前端回灌后下一次重试的乐观锁令牌才是有效的，否则必撞 409。
  return Response.json(
    {
      error: result.message,
      ...(result.article && result.assets
        ? { article: result.article, assets: result.assets }
        : {})
    },
    { status: 502 }
  );
}

export function createImageAssetGenerateRouteHandler(
  _articles: ArticleRepository,
  images: ImageAssetRepository,
  generator: ImageGenerator | null,
  storageDir?: string,
  /** 画风/参考形象增强依赖；缺省为空（生成退化为纯 prompt）。 */
  enhancements: GenerationEnhancementDependencies = {}
) {
  return async function POST(request: Request, context: RouteContext) {
    if (!generator) {
      return Response.json({ error: "图片生成服务未配置" }, { status: 503 });
    }
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

    const dependencies: GenerateImageAssetDependencies = { images, generator, ...enhancements };
    if (storageDir) dependencies.storageDir = storageDir;
    return generationResponse(
      await generateImageAsset(
        {
          articleId: id,
          assetId,
          expectedUpdatedAt: input.data.expectedUpdatedAt,
          ...(input.data.model ? { model: input.data.model } : {})
        },
        dependencies
      )
    );
  };
}

export function POST(request: Request, context: RouteContext) {
  return createImageAssetGenerateRouteHandler(
    getArticleRepository(),
    getImageAssetRepository(),
    getImageGenerator(),
    undefined,
    {
      planSettings: new SqliteImagePlanSettingsRepository(getDatabase()),
      characters: getReferenceCharacterRepository(),
      styleLibrary: getStyleLibraryRepository()
    }
  )(request, context);
}
