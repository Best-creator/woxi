import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import { composeComicStrips, removeComicStrips } from "@/features/images/compose-comic-strip";
import type { ImageAssetRepository } from "@/features/images/repository";
import { getArticleRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";
// 拼图是纯 CPU 活（sharp 合成 + PNG 编码），不调外部服务，比生图快得多；
// 但仍然不开成同步接口，超时就交给平台兜底。
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  mode: z.enum(["image_text", "text_image", "image_text_image"])
});

function notFound() {
  return Response.json({ error: "文章不存在" }, { status: 404 });
}

function conflict() {
  return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
}

export function createComicStripComposeHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository
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
      return Response.json({ error: "拼图参数无效" }, { status: 400 });
    }

    const result = await composeComicStrips(
      {
        articleId: id,
        expectedUpdatedAt: input.data.expectedUpdatedAt,
        mode: input.data.mode
      },
      { articles, images }
    );

    if (result.kind === "not_found") return notFound();
    if (result.kind === "conflict") return conflict();
    if (result.kind === "not_ready") return Response.json({ error: result.message }, { status: 400 });
    if (result.kind === "compose_error") return Response.json({ error: result.message }, { status: 500 });

    return Response.json({
      article: result.article,
      assets: result.assets,
      strips: result.strips
    });
  };
}

export function createComicStripRemoveHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository
) {
  return async function DELETE(request: Request, context: RouteContext) {
    const { id } = await context.params;
    // DELETE 不带请求体：版本号走查询串，语义更直白，也不会被中间层丢掉。
    const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? "";
    if (!z.iso.datetime().safeParse(expectedUpdatedAt).success) {
      return Response.json({ error: "文章版本信息无效" }, { status: 400 });
    }

    const result = await removeComicStrips(
      { articleId: id, expectedUpdatedAt },
      { articles, images }
    );

    if (result.kind === "not_found") return notFound();
    if (result.kind === "conflict") return conflict();
    return Response.json({ article: result.article, assets: result.assets });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createComicStripComposeHandler(getArticleRepository(), getImageAssetRepository())(
    request,
    context
  );
}

export function DELETE(request: Request, context: RouteContext) {
  return createComicStripRemoveHandler(getArticleRepository(), getImageAssetRepository())(
    request,
    context
  );
}
