import { z } from "zod";
import { resolveAudience } from "@/features/content/audience";
import { stylePresetSchema, styleProfileSchema } from "@/features/content/schemas";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { MAX_USER_INSTRUCTIONS_LENGTH } from "@/features/outlines/domain";
import {
  reviseStoryboard,
  type ReviseStoryboardDependencies
} from "@/features/content/revise-storyboard";
import {
  getArticleRepository,
  getContentDefaultModel,
  getImageAssetRepository,
  getStoryboardDesigner,
  getContentWorkflowRepository,
  getSourceRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 与 generate 路由同款：允许只传 { preset }（可带 customInstructions、audience）。 */
const styleProfileRequestSchema = z.preprocess((value) => {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!input) return value;
  const preset = stylePresetSchema.safeParse(input.preset);
  if (!preset.success) return value;
  if (
    !Object.keys(input).every(
      (key) => key === "preset" || key === "customInstructions" || key === "audience"
    )
  ) {
    return value;
  }
  const customInstructions = typeof input.customInstructions === "string" ? input.customInstructions : "";
  return resolveStyleProfile(preset.data, customInstructions, resolveAudience(input.audience));
}, styleProfileSchema);

const characterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().trim().max(200),
  description: z.string().trim().max(600)
});

const reviseContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  styleProfile: styleProfileRequestSchema,
  drawingStyle: z.string().trim().min(1).max(600).optional(),
  character: characterSchema.optional(),
  userInstructions: z.string().trim().min(1).max(MAX_USER_INSTRUCTIONS_LENGTH).optional()
});

const errorResponses = {
  not_found: { status: 404, error: "文章不存在" },
  conflict: { status: 409, error: "文章已在其他位置更新，请刷新后重试" },
  not_ready: { status: 400, error: "请先确认大纲再修订分镜" },
  stale_outline: { status: 400, error: "当前正文基于旧大纲，请先重新生成分镜脚本" },
  no_storyboard: { status: 400, error: "当前正文还没有分镜设计，请先重新生成分镜脚本" },
  review_required: { status: 400, error: "请先审核文案，或直接写下你的修改要求" },
  no_revision_needed: { status: 400, error: "审核已通过，无需修订；可以直接确认内容，或写下你的修改要求" }
} as const;

export function createContentReviseRouteHandler(dependencies: ReviseStoryboardDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = reviseContentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "分镜修订请求无效" }, { status: 400 });

    const result = await reviseStoryboard({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "designer_error" || result.kind === "save_error") {
      return Response.json({ error: result.message }, { status: result.kind === "designer_error" ? 502 : 409 });
    }
    if (result.kind !== "revised") {
      const mapped = errorResponses[result.kind];
      return Response.json({ error: mapped.error }, { status: mapped.status });
    }
    return Response.json({
      article: result.article,
      revision: result.revision,
      replacedSegments: result.replacedSegments,
      retainedSegments: result.retainedSegments
    });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createContentReviseRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    designer: getStoryboardDesigner(),
    workflow: getContentWorkflowRepository(),
    images: getImageAssetRepository(),
    defaultModel: getContentDefaultModel()
  })(request, context);
}
