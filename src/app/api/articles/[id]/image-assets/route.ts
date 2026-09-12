import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository } from "@/features/images/repository";
import { getArticleRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createImageAssetListRouteHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository
) {
  return async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;
    const article = await articles.findById(id);
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 });
    }

    return Response.json({ assets: await images.list(id) });
  };
}

export function GET(request: Request, context: RouteContext) {
  return createImageAssetListRouteHandler(
    getArticleRepository(),
    getImageAssetRepository()
  )(request, context);
}
