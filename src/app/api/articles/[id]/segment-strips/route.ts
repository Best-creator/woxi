import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import { composeSegmentStrips } from "@/features/images/compose-segment-strips";
import type { ImageAssetRepository } from "@/features/images/repository";
import { getArticleRepository, getImageAssetRepository } from "@/server/services";

export const runtime = "nodejs";
// 拼接是 CPU 活（每段一次 sharp 合成 + PNG 编码，段多时线性增长）；
// 不开成同步接口，超时交给平台兜底。
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  // 可选：本次拼接使用的字体 id（images 域 STORYBOARD_FONT_OPTIONS），传入即持久化进
  // planning；缺省沿用已存选择，从未选过则回落默认黑体。
  fontId: z.string().trim().min(1).max(64).optional()
});

function notFound() {
  return Response.json({ error: "文章不存在" }, { status: 404 });
}

function conflict() {
  return Response.json({ error: "文章已在其他位置更新，请刷新后重试" }, { status: 409 });
}

export function createSegmentStripsComposeHandler(
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
      return Response.json({ error: "拼接参数无效" }, { status: 400 });
    }

    const result = await composeSegmentStrips(
      {
        articleId: id,
        expectedUpdatedAt: input.data.expectedUpdatedAt,
        fontId: input.data.fontId ?? null
      },
      { articles, images }
    );

    if (result.kind === "not_found") return notFound();
    if (result.kind === "conflict") return conflict();
    if (result.kind === "not_ready") {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if (result.kind === "compose_error") {
      return Response.json({ error: result.message }, { status: 500 });
    }

    return Response.json({
      article: result.article,
      assets: result.assets,
      strips: result.strips,
      fontFamily: result.fontFamily
    });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createSegmentStripsComposeHandler(getArticleRepository(), getImageAssetRepository())(
    request,
    context
  );
}
