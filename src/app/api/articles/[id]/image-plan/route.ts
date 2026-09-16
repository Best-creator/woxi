import { z } from "zod";
import type { ReferenceCharacterRepository } from "@/features/characters/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository } from "@/features/images/repository";
import { planImages } from "@/features/images/plan-images";
import type { VisualPlanner } from "@/features/images/visual-planner";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import {
  isLibraryStyleRef,
  libraryStyleId,
  styleToGuideText
} from "@/features/style-library/style-guide";
import {
  getArticleRepository,
  getImageAssetRepository,
  getReferenceCharacterRepository,
  getStyleLibraryRepository,
  getVisualPlanner
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 150;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  style: z.string().trim().min(1).max(200).optional(),
  characterId: z.string().trim().min(1).optional()
});

export function createImagePlanRouteHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository,
  planner: VisualPlanner,
  characters: ReferenceCharacterRepository | null = null,
  styleLibrary: StyleLibraryRepository | null = null
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

    // 绘制风格：风格库条目由服务端解析成完整风格文本（library:<id>），
    // 自由文本与预设词原样透传——两种形态都不信任客户端拼好的长文案。
    let style: string | undefined;
    if (input.data.style) {
      if (isLibraryStyleRef(input.data.style)) {
        if (!styleLibrary) {
          return Response.json({ error: "风格库功能不可用" }, { status: 400 });
        }
        const entry = await styleLibrary.findById(libraryStyleId(input.data.style));
        if (!entry) {
          return Response.json({ error: "所选风格已不存在，请重新选择" }, { status: 400 });
        }
        style = styleToGuideText(entry.profile);
      } else {
        style = input.data.style;
      }
    }

    // 参考形象由服务端解析成外形描述，避免信任客户端拼好的文案。
    let character;
    if (input.data.characterId) {
      if (!characters) {
        return Response.json({ error: "参考形象功能不可用" }, { status: 400 });
      }
      const record = await characters.findById(input.data.characterId);
      if (!record) {
        return Response.json({ error: "参考形象不存在或已删除，请重新选择" }, { status: 400 });
      }
      character = {
        name: record.name,
        persona: record.persona,
        description: record.description
      };
    }

    const result = await planImages(id, input.data.expectedUpdatedAt, articles, images, planner, {
      ...(input.data.model ? { model: input.data.model } : {}),
      ...(style ? { style } : {}),
      ...(character ? { character } : {})
    });
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
    getVisualPlanner(),
    getReferenceCharacterRepository(),
    getStyleLibraryRepository()
  )(request, context);
}
