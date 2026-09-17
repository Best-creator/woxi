import { z } from "zod";
import type { ArticleRepository } from "@/features/articles/repository";
import type { ImageAssetRepository } from "@/features/images/repository";
import { WECHAT_THEMES } from "@/features/publishing/themes";
import {
  SqliteWechatDraftRecordRepository,
  publishArticleDraft,
  type WechatDraftRecordRepository
} from "@/features/publishing/publish-article-draft";
import type { WechatDraftImage, WechatDraftPublisher } from "@/features/publishing/wechat-draft";
import type { ImageAsset } from "@/features/images/domain";
import {
  getArticleRepository,
  getDatabase,
  getImageAssetRepository,
  getWechatDraftPublisher
} from "@/server/services";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  themeId: z.enum(Object.keys(WECHAT_THEMES) as [keyof typeof WECHAT_THEMES]),
  /** 相同内容重复推送时允许强制再来一份（默认拒绝，防草稿箱堆积）。 */
  force: z.boolean().default(false)
});

export function createPublishWechatRouteHandler(
  articles: ArticleRepository,
  images: ImageAssetRepository,
  publisher: WechatDraftPublisher | null,
  records: WechatDraftRecordRepository,
  readAssetFile?: (asset: ImageAsset) => Promise<WechatDraftImage>
) {
  return async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    if (!publisher) {
      return Response.json(
        { error: "公众号推送未启用：请在 env/.env.local 配置 WECHAT_APPID 与 WECHAT_APPSECRET" },
        { status: 400 }
      );
    }
    const article = await articles.findById(id);
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 });
    }
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const input = requestSchema.safeParse(body);
    if (!input.success) {
      return Response.json({ error: "推送参数无效" }, { status: 400 });
    }

    const assets = await images.list(id);
    const result = await publishArticleDraft(
      { article, assets, themeId: input.data.themeId, force: input.data.force },
      {
        publisher,
        records,
        ...(readAssetFile ? { readAssetFile } : {})
      }
    );

    if (result.kind === "no_content") {
      return Response.json({ error: "文章没有可推送的正文内容" }, { status: 400 });
    }
    if (result.kind === "strips_not_ready" || result.kind === "residual_text") {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if (result.kind === "no_cover") {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if (result.kind === "missing_files") {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if (result.kind === "duplicate") {
      return Response.json(
        {
          error: `相同内容已于 ${result.record.createdAt.slice(0, 16).replace("T", " ")} 推送过草稿；如需再推一次请勾选「强制重新推送」`,
          duplicate: true
        },
        { status: 409 }
      );
    }
    if (result.kind === "publisher_error") {
      return Response.json({ error: result.message }, { status: 502 });
    }
    return Response.json({ record: result.record, replacements: result.replacements });
  };
}

export function POST(request: Request, context: RouteContext) {
  return createPublishWechatRouteHandler(
    getArticleRepository(),
    getImageAssetRepository(),
    getWechatDraftPublisher(),
    new SqliteWechatDraftRecordRepository(getDatabase())
  )(request, context);
}
