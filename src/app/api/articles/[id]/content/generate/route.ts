import { z } from "zod";
import { stylePresetSchema, styleProfileSchema } from "@/features/content/schemas";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { generateContent, type GenerateContentDependencies } from "@/features/content/generate-content";
import {
  getArticleRepository,
  getContentDefaultModel,
  getContentGenerator,
  getContentWorkflowRepository,
  getSourceRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 调用方可以只给 `{ preset }`（可带 `customInstructions`），由服务端补齐预设派生字段；
 * 也可以传完整 profile，行为不变。
 */
const styleProfileRequestSchema = z.preprocess((value) => {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!input) return value;
  const preset = stylePresetSchema.safeParse(input.preset);
  if (!preset.success) return value;
  if (!Object.keys(input).every((key) => key === "preset" || key === "customInstructions")) {
    return value;
  }
  const customInstructions = typeof input.customInstructions === "string" ? input.customInstructions : "";
  return resolveStyleProfile(preset.data, customInstructions);
}, styleProfileSchema);

const generateContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  styleProfile: styleProfileRequestSchema
});

export function createContentGenerateRouteHandler(dependencies: GenerateContentDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = generateContentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "正文生成请求无效" }, { status: 400 });

    const result = await generateContent({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "not_ready") return Response.json({ error: "请先确认大纲再生成正文" }, { status: 400 });
    if (result.kind === "generator_error") return Response.json({ error: result.message }, { status: 502 });
    if (result.kind === "save_error") return Response.json({ error: result.message }, { status: 409 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createContentGenerateRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    generator: getContentGenerator(),
    workflow: getContentWorkflowRepository(),
    defaultModel: getContentDefaultModel()
  })(request, context);
}
