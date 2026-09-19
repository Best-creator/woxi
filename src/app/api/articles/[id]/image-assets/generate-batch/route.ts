import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import {
  generateImageAssetsBatch,
  type GenerateImageAssetsBatchDependencies
} from "@/features/images/generate-image-assets-batch";
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
// 批量并行生成的耗时≈最慢一张，放宽到与单张生成一致的上限。
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).max(100).optional()
});

function batchResponse(result: Awaited<ReturnType<typeof generateImageAssetsBatch>>) {
  if (result.kind === "saved") {
    return Response.json({
      article: result.article,
      assets: result.assets,
      results: result.results,
      succeeded: result.succeeded,
      failed: result.failed
    });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  if (result.kind === "nothing_pending") {
    return Response.json({ error: "没有待生成的配图" }, { status: 400 });
  }
  return Response.json({ error: "批量生成失败，请稍后重试" }, { status: 502 });
}

export function createImageAssetBatchRouteHandler(
  articles: ArticleRepository,
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
    const { id } = await context.params;
    if (!(await articles.findById(id))) {
      return Response.json({ error: "文章不存在" }, { status: 404 });
    }
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

    const dependencies: GenerateImageAssetsBatchDependencies = {
      images,
      generator,
      ...enhancements
    };
    if (storageDir) dependencies.storageDir = storageDir;
    return batchResponse(
      await generateImageAssetsBatch(
        {
          articleId: id,
          expectedUpdatedAt: input.data.expectedUpdatedAt,
          ...(input.data.model ? { model: input.data.model } : {})
        },
        dependencies
      )
    );
  };
}

export function POST(request: Request, context: RouteContext) {
  return createImageAssetBatchRouteHandler(
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
