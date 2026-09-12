import { updateArticleSchema } from "@/features/articles/schemas";
import type { ArticleRepository } from "@/features/articles/repository";
import { getArticleRepository } from "@/server/services";
import type { KnowledgeBrief } from "@/features/articles/domain";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createArticleRouteHandlers(repository: ArticleRepository) {
  return {
    async GET(_request: Request, context: RouteContext) {
      const { id } = await context.params;
      const article = await repository.findById(id);
      if (!article) {
        return Response.json({ error: "文章不存在" }, { status: 404 });
      }
      return Response.json({ article });
    },

    async PATCH(request: Request, context: RouteContext) {
      const { id } = await context.params;
      const existing = await repository.findById(id);
      if (!existing) {
        return Response.json({ error: "文章不存在" }, { status: 404 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }

      const input = updateArticleSchema.safeParse(body);
      if (!input.success) {
        return Response.json(
          { error: input.error.issues[0]?.message ?? "文章信息无效" },
          { status: 400 }
        );
      }

      const { expectedUpdatedAt, ...changes } = input.data;
      const briefChanged = "brief" in changes && JSON.stringify(changes.brief as KnowledgeBrief | null) !== JSON.stringify(existing.brief);
      const nextArticle = briefChanged
        ? {
          ...existing,
          ...changes,
          blocks: [],
          planning: { ...existing.planning, confirmedOutlineRevisionId: null, contentOutlineRevisionId: null },
          outlineConfirmedAt: null,
          status: changes.brief ? "brief_ready" as const : "draft" as const
        }
        : { ...existing, ...changes };
      const result = await repository.save(
        nextArticle,
        expectedUpdatedAt
      );

      if (result.kind === "conflict") {
        return Response.json(
          { error: "文章已在其他位置更新，请刷新后重试" },
          { status: 409 }
        );
      }

      return Response.json({ article: result.article });
    }
  };
}

export function GET(request: Request, context: RouteContext) {
  return createArticleRouteHandlers(getArticleRepository()).GET(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return createArticleRouteHandlers(getArticleRepository()).PATCH(request, context);
}
