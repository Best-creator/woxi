import { z } from "zod";
import type { SourceRepository } from "@/features/sources/repository";
import { parseSource } from "@/features/sources/source-parser";
import type { SourceType } from "@/features/sources/domain";
import { getArticleRepository, getSourceRepository, getSourceWorkflow } from "@/server/services";
import type { SqliteSourceWorkflow } from "@/features/sources/sqlite-workflow";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const createSourceSchema = z.object({
  title: z.string().trim().min(1, "请输入资料标题和内容").max(160),
  type: z.enum(["text", "markdown", "web", "pdf", "docx"]),
  content: z.string().trim().min(1, "请输入资料标题和内容").max(100_000),
  expectedUpdatedAt: z.iso.datetime()
});

export function createSourceRouteHandlers(
  articles: { findById(id: string): Promise<unknown> },
  sources: SourceRepository,
  workflow: SqliteSourceWorkflow
) {
  return {
    async GET(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      if (!(await articles.findById(id))) {
        return Response.json({ error: "文章不存在" }, { status: 404 });
      }
      return Response.json({ sources: await sources.list(id) });
    },

    async POST(request: Request, context: RouteContext) {
      const { id } = await context.params;
      const article = await articles.findById(id);
      if (!article) {
        return Response.json({ error: "文章不存在" }, { status: 404 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }

      const input = createSourceSchema.safeParse(body);
      if (!input.success) {
        return Response.json(
          { error: input.error.issues[0]?.message ?? "资料信息无效" },
          { status: 400 }
        );
      }

      const result = await workflow.create(id, input.data.expectedUpdatedAt, {
        title: input.data.title,
        type: input.data.type as SourceType,
        content: parseSource({ type: input.data.type as SourceType, content: input.data.content }).content
      });
      if (result.kind === "conflict") {
        return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
      }
      if (result.kind === "not_found") return Response.json({ error: "文章不存在" }, { status: 404 });
      return Response.json({ source: result.source, article: result.article }, { status: 201 });
    }
  };
}

export function GET(request: Request, context: RouteContext) {
  return createSourceRouteHandlers(getArticleRepository(), getSourceRepository(), getSourceWorkflow()).GET(
    request,
    context
  );
}

export function POST(request: Request, context: RouteContext) {
  return createSourceRouteHandlers(getArticleRepository(), getSourceRepository(), getSourceWorkflow()).POST(
    request,
    context
  );
}
