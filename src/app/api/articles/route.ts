import { createArticleSchema } from "@/features/articles/schemas";
import type { ArticleRepository } from "@/features/articles/repository";
import { getArticleRepository } from "@/server/services";

export const runtime = "nodejs";

export function createArticlesRouteHandlers(repository: ArticleRepository) {
  return {
    async GET() {
      return Response.json({ articles: await repository.list() });
    },

    async POST(request: Request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }

      const input = createArticleSchema.safeParse(body);
      if (!input.success) {
        return Response.json(
          { error: input.error.issues[0]?.message ?? "文章信息无效" },
          { status: 400 }
        );
      }

      const article = await repository.create(input.data);
      return Response.json({ article }, { status: 201 });
    }
  };
}

export function GET() {
  return createArticlesRouteHandlers(getArticleRepository()).GET();
}

export function POST(request: Request) {
  return createArticlesRouteHandlers(getArticleRepository()).POST(request);
}
