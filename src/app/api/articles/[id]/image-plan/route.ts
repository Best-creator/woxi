import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository } from "@/features/images/repository";
import { planImages } from "@/features/images/plan-images";
import type { VisualPlanner } from "@/features/images/visual-planner";
import {
  getArticleRepository,
  getImageAssetRepository,
  getVisualPlanner
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 150;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

export function createImagePlanRouteHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository,
  planner: VisualPlanner
) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
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

    const result = await planImages(id, input.data.expectedUpdatedAt, articles, images, planner);
    if (result.kind === "not_found") {
      return Response.json({ error: "文章不存在" }, { status: 404 });
    }
    if (result.kind === "no_content") {
      return Response.json({ error: "文章没有可供配图的正文" }, { status: 400 });
    }
    if (result.kind === "stale_content") {
      return Response.json({ error: "当前正文基于旧大纲，请先重新生成正文再配图" }, { status: 400 });
    }
    if (result.kind === "invalid_plan") {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if (result.kind === "planner_error") {
      return Response.json({ error: result.message }, { status: 502 });
    }
    if (result.kind === "conflict") {
      return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    }
    return Response.json({ article: result.article, assets: result.assets });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createImagePlanRouteHandler(
    getArticleRepository(),
    getImageAssetRepository(),
    getVisualPlanner()
  )(request, context);
}
