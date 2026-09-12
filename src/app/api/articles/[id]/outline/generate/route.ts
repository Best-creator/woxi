import { z } from "zod";
import { generateOutline, type GenerateOutlineDependencies } from "@/features/outlines/generate-outline";
import { getArticleRepository, getOutlineDefaultModel, getOutlineGenerator, getOutlineWorkflowRepository, getSourceRepository } from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const generateRequestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  model: z.string().trim().min(1).optional(),
  lengthPreset: z.enum(["short", "standard", "deep"])
});

export function createOutlineGenerateRouteHandler(dependencies: GenerateOutlineDependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const parsed = generateRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "大纲生成请求无效" }, { status: 400 });
    const result = await generateOutline({ articleId: id, ...parsed.data }, dependencies);
    if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
    if (result.kind === "generator_error") return Response.json({ error: result.message }, { status: 502 });
    return Response.json({ article: result.article, revision: result.revision });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createOutlineGenerateRouteHandler({
    articles: getArticleRepository(),
    sources: getSourceRepository(),
    generator: getOutlineGenerator(),
    workflow: getOutlineWorkflowRepository(),
    defaultModel: getOutlineDefaultModel()
  })(request, context);
}
