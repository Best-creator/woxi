import { z } from "zod";
import type { SourceRepository } from "@/features/sources/repository";
import type { SqliteSourceWorkflow } from "@/features/sources/sqlite-workflow";
import { getArticleRepository, getSourceRepository, getSourceWorkflow } from "@/server/services";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string; sourceId: string }>; }

const updateSourceSchema = z.object({ enabled: z.boolean(), expectedUpdatedAt: z.iso.datetime() });
const deleteSourceSchema = z.object({ expectedUpdatedAt: z.iso.datetime() });

export function createSourceItemRouteHandlers(
  articles: { findById(id: string): Promise<unknown> },
  _sources: SourceRepository,
  workflow: SqliteSourceWorkflow
) {
  return {
    async PATCH(request: Request, context: RouteContext) {
      const { id, sourceId } = await context.params;
      if (!(await articles.findById(id))) return Response.json({ error: "文章不存在" }, { status: 404 });
      const input = updateSourceSchema.safeParse(await request.json().catch(() => null));
      if (!input.success) return Response.json({ error: "资料状态无效" }, { status: 400 });
      const result = await workflow.updateEnabled(id, sourceId, input.data.expectedUpdatedAt, input.data.enabled);
      if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      if (result.kind === "not_found") return Response.json({ error: result.target === "article" ? "文章不存在" : "资料不存在" }, { status: 404 });
      return Response.json({ source: result.source, article: result.article });
    },

    async DELETE(request: Request, context: RouteContext) {
      const { id, sourceId } = await context.params;
      if (!(await articles.findById(id))) return Response.json({ error: "文章不存在" }, { status: 404 });
      const input = deleteSourceSchema.safeParse(await request.json().catch(() => null));
      if (!input.success) return Response.json({ error: "文章版本信息无效" }, { status: 400 });
      const result = await workflow.remove(id, sourceId, input.data.expectedUpdatedAt);
      if (result.kind === "conflict") return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      if (result.kind === "not_found") return Response.json({ error: result.target === "article" ? "文章不存在" : "资料不存在" }, { status: 404 });
      return Response.json({ article: result.article });
    }
  };
}

export function PATCH(request: Request, context: RouteContext) {
  return createSourceItemRouteHandlers(getArticleRepository(), getSourceRepository(), getSourceWorkflow()).PATCH(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return createSourceItemRouteHandlers(getArticleRepository(), getSourceRepository(), getSourceWorkflow()).DELETE(request, context);
}
