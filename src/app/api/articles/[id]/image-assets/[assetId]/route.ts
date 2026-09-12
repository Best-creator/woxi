import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository, ImagePlanMutationResult } from "@/features/images/repository";
import { getArticleRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; assetId: string }>;
}

const expectedUpdatedAtSchema = z.object({
  expectedUpdatedAt: z.iso.datetime()
});

export const updateImageAssetSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  anchorBlockId: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  altText: z.string().trim().min(1).max(240).optional(),
  aspectRatio: z.enum(["cover", "landscape", "square", "portrait"]).optional(),
  enabled: z.boolean().optional()
}).refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"), {
  message: "至少提供一项修改"
});

function mutationResponse(result: ImagePlanMutationResult) {
  if (result.kind === "saved") {
    return Response.json({ article: result.article, assets: result.assets });
  }
  if (result.kind === "conflict") {
    return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "图片资产不存在" }, { status: 404 });
  }
  if (result.kind === "invalid_anchor") {
    return Response.json({ error: "图片锚点不存在" }, { status: 400 });
  }
  return Response.json({ error: result.message }, { status: 400 });
}

type ParsedJson =
  | { kind: "body"; body: unknown }
  | { kind: "invalid_json"; response: Response };

async function readJson(request: Request): Promise<ParsedJson> {
  try {
    return { kind: "body", body: await request.json() };
  } catch {
    return {
      kind: "invalid_json",
      response: Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 })
    };
  }
}

export function createImageAssetRouteHandlers(
  _articles: ArticleRepository,
  images: ImageAssetRepository
) {
  return {
    async PATCH(request: Request, context: RouteContext) {
      const { id, assetId } = await context.params;
      const parsed = await readJson(request);
      if (parsed.kind === "invalid_json") return parsed.response;
      const input = updateImageAssetSchema.safeParse(parsed.body);
      if (!input.success) {
        return Response.json(
          { error: input.error.issues[0]?.message ?? "图片资产信息无效" },
          { status: 400 }
        );
      }

      const { expectedUpdatedAt, ...patch } = input.data;
      return mutationResponse(await images.update(id, assetId, expectedUpdatedAt, patch));
    },

    async DELETE(request: Request, context: RouteContext) {
      const { id, assetId } = await context.params;
      const parsed = await readJson(request);
      if (parsed.kind === "invalid_json") return parsed.response;
      const input = expectedUpdatedAtSchema.safeParse(parsed.body);
      if (!input.success) {
        return Response.json({ error: "文章版本信息无效" }, { status: 400 });
      }

      return mutationResponse(await images.remove(id, assetId, input.data.expectedUpdatedAt));
    }
  };
}

export function PATCH(request: Request, context: RouteContext) {
  return createImageAssetRouteHandlers(
    getArticleRepository(),
    getImageAssetRepository()
  ).PATCH(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return createImageAssetRouteHandlers(
    getArticleRepository(),
    getImageAssetRepository()
  ).DELETE(request, context);
}
