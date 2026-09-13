import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import {
  SqliteImagePlanSettingsRepository,
  type ImagePlanSettingsRepository
} from "@/features/images/plan-settings";
import { getArticleRepository, getDatabase } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const putSchema = z.object({
  style: z.string().trim().max(200).default(""),
  characterId: z.string().trim().min(1).nullable().default(null)
});

export function createImageSettingsRouteHandler(
  articles: ArticleRepository,
  settings: ImagePlanSettingsRepository
) {
  return {
    async GET(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      if (!(await articles.findById(id))) {
        return Response.json({ error: "文章不存在" }, { status: 404 });
      }
      return Response.json(await settings.get(id));
    },

    async PUT(request: Request, context: RouteContext) {
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
      const input = putSchema.safeParse(body);
      if (!input.success) {
        return Response.json({ error: "配图偏好无效" }, { status: 400 });
      }
      await settings.set(id, input.data);
      return Response.json(await settings.get(id));
    }
  };
}

export function GET(request: Request, context: RouteContext) {
  return createImageSettingsRouteHandler(
    getArticleRepository(),
    new SqliteImagePlanSettingsRepository(getDatabase())
  ).GET(request, context);
}

export function PUT(request: Request, context: RouteContext) {
  return createImageSettingsRouteHandler(
    getArticleRepository(),
    new SqliteImagePlanSettingsRepository(getDatabase())
  ).PUT(request, context);
}
