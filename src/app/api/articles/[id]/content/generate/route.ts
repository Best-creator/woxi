import { z } from "zod";
import { resolveAudience } from "@/features/content/audience";
import { stylePresetSchema, styleProfileSchema } from "@/features/content/schemas";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { generateContent, type GenerateContentDependencies } from "@/features/content/generate-content";
import { SqliteImagePlanSettingsRepository } from "@/features/images/plan-settings";
import { resolveStyleText } from "@/features/images/style-text";
import {
  getArticleRepository,
  getContentDefaultModel,
  getDatabase,
  getImageAssetRepository,
  getStoryboardDesigner,
  getContentWorkflowRepository,
  getSourceRepository,
  getStyleLibraryRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 调用方可以只给 `{ preset }`（可带 `customInstructions`、`audience`），由服务端补齐预设派生字段；
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

/** 参考形象摘要：设计分镜时烘进每一帧 prompt，保证主角跨段一致。 */
const characterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().trim().max(200),
  description: z.string().trim().max(600)
});

const generateContentRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  styleProfile: styleProfileRequestSchema,
  /** 呈现形态开关（第三步界面上选）：缺省由文章推断（新文剧情漫画 / 旧文讲解式）。 */
  presentation: z.enum(["illustrated", "story_comic"]).optional(),
  drawingStyle: z.string().trim().min(1).max(600).optional(),
  character: characterSchema.optional()
});

/**
 * 路由层额外依赖：把文章「第四步配图偏好」里的画风解析成设计阶段可用的画风文本。
 *
 * 为什么必须在设计阶段就知道画风：帧提示词是第三步写下的，如果那时不知道画风，模型会按默认
 * 口径把「日系动漫画风、赛璐璐上色」写进每一格；到第四步生图时再前置所选画风，两套风格词
 * 直接打架——实测出图完全听帧提示词的，所选的风格一点没落地（详见 `composeEnhancedPrompt`
 * 末尾的「画风优先」）。放在路由层而不是 content 领域，是因为它跨了 images 域。
 */
interface ContentGenerateRouteDependencies extends GenerateContentDependencies {
  resolveDrawingStyle?: (articleId: string) => Promise<string | null>;
}

export function createContentGenerateRouteHandler(dependencies: ContentGenerateRouteDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = generateContentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "正文分镜设计请求无效" }, { status: 400 });

    // 客户端显式传来的画风优先；没传时按文章的配图偏好兜底（读取失败退回默认口径）。
    const { drawingStyle: explicitStyle, ...rest } = parsed.data;
    const drawingStyle = explicitStyle ?? (await dependencies.resolveDrawingStyle?.(id)) ?? undefined;
    const result = await generateContent(
      { articleId: id, ...rest, ...(drawingStyle ? { drawingStyle } : {}) },
      dependencies
    );
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "not_ready") return Response.json({ error: "请先确认大纲再设计正文分镜" }, { status: 400 });
    if (result.kind === "designer_error") return Response.json({ error: result.message }, { status: 502 });
    if (result.kind === "save_error") return Response.json({ error: result.message }, { status: 409 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

/**
 * 读文章的配图偏好（第四步「生成偏好」保存的画风），解析成完整画风文本。
 * 任何读取失败都返回 null：画风只是让出图更像目标风格，绝不能挡住第三步设计。
 */
async function readArticleDrawingStyle(articleId: string): Promise<string | null> {
  try {
    const settings = await new SqliteImagePlanSettingsRepository(getDatabase()).get(articleId);
    return await resolveStyleText(settings.style, getStyleLibraryRepository());
  } catch {
    return null;
  }
}

export function POST(request: Request, context: RouteContext) {
  return createContentGenerateRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    designer: getStoryboardDesigner(),
    workflow: getContentWorkflowRepository(),
    images: getImageAssetRepository(),
    defaultModel: getContentDefaultModel(),
    resolveDrawingStyle: readArticleDrawingStyle
  })(request, context);
}
