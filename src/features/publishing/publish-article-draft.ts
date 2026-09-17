import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "@/features/images/domain";
import { inspectPublishReadiness } from "./inspect-publish-readiness";
import { renderWechatHtml, renderWechatStripFlowHtml } from "./render-wechat-html";
import type { ThemeId } from "./themes";
import type { WechatDraftImage, WechatDraftPublisher } from "./wechat-draft";

/** 文章内容指纹：同内容重复推送时提示已推过，防止草稿箱堆积。 */
export function articleDraftHash(articleId: string, contentHtml: string): string {
  return createHash("sha256").update(`${articleId}\n${contentHtml}`).digest("hex").slice(0, 32);
}

export interface ArticleDraftPushRecord {
  id: string;
  articleId: string;
  mediaId: string;
  title: string;
  themeId: ThemeId;
  contentHash: string;
  createdAt: string;
}

/** 推送记录仓储（独立于 article 聚合：推送不改内容，不推进 updatedAt）。 */
export interface WechatDraftRecordRepository {
  listByArticle(articleId: string): Promise<ArticleDraftPushRecord[]>;
  save(record: ArticleDraftPushRecord): Promise<void>;
}

export class SqliteWechatDraftRecordRepository implements WechatDraftRecordRepository {
  constructor(private readonly db: import("node:sqlite").DatabaseSync) {}

  async listByArticle(articleId: string): Promise<ArticleDraftPushRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM wechat_drafts WHERE article_id = ? ORDER BY created_at DESC")
      .all(articleId) as unknown as Array<{
      id: string; article_id: string; media_id: string; title: string;
      theme_id: string; content_hash: string; created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      mediaId: row.media_id,
      title: row.title,
      themeId: row.theme_id as ThemeId,
      contentHash: row.content_hash,
      createdAt: row.created_at
    }));
  }

  async save(record: ArticleDraftPushRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO wechat_drafts (id, article_id, media_id, title, theme_id, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(record.id, record.articleId, record.mediaId, record.title, record.themeId, record.contentHash, record.createdAt);
  }
}

/** 读取资产文件为上传载荷；文件缺失（老数据/被清理）时给出可读错误。 */
async function assetToDraftImage(asset: ImageAsset): Promise<WechatDraftImage> {
  if (!asset.filePath) {
    throw new Error(`配图「${asset.purpose || asset.id}」没有本地文件，请重新生成后再推送`);
  }
  const extension = asset.filePath.split(".").pop()?.toLowerCase() ?? "png";
  const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
  return {
    sourceUrl: `/api/image-assets/${asset.id}/content`,
    data: await readFile(asset.filePath),
    mimeType,
    filename: `${asset.id}.${extension}`
  };
}

export interface PublishArticleDraftDependencies {
  publisher: WechatDraftPublisher;
  records: WechatDraftRecordRepository;
  readAssetFile?: (asset: ImageAsset) => Promise<WechatDraftImage>;
  now?: () => Date;
}

export type PublishArticleDraftResult =
  | { kind: "saved"; record: ArticleDraftPushRecord; replacements: Record<string, string> }
  | { kind: "no_content" }
  | { kind: "no_cover"; message: string }
  | { kind: "missing_files"; message: string }
  | { kind: "duplicate"; record: ArticleDraftPushRecord }
  | { kind: "strips_not_ready"; message: string }
  | { kind: "residual_text"; message: string }
  | { kind: "publisher_error"; message: string };

/**
 * 把文章推送到公众号草稿箱，按「有无分镜设计」走两条路：
 *
 * - 纯段图流（有 planning.storyboardSegments）：正文必须全部拼成段图，
 *   推送内容 = 封面 + 段图序列（无可复制正文文字）；残留块默认拒推，
 *   作者 force 确认后保留为段图之间的图文；digest 取第一段文案开头显式传入。
 * - 旧混合流（无分镜设计的文章）：行为与历史完全一致——hasText 门 +
 *   通用块渲染，digest 留空由微信抓取正文。
 *
 * 共同点：封面取第一个 generated 的 cover 资产 → 正文图取 blocks 里 image block
 * 引用的资产 → 调 publisher 四步链路 → 记录推送历史（内容指纹防重）。
 */
export async function publishArticleDraft(
  input: { article: Article; assets: ImageAsset[]; themeId: ThemeId; force?: boolean },
  dependencies: PublishArticleDraftDependencies
): Promise<PublishArticleDraftResult> {
  const { article, assets, themeId, force } = input;
  const readiness = inspectPublishReadiness(article, assets);
  const stripFlow = readiness.mode === "strip_flow";

  if (stripFlow) {
    if (readiness.missingStrips.length) {
      const titles = readiness.missingStrips
        .map((segment) => `「${segment.title}」`)
        .join("、");
      return {
        kind: "strips_not_ready",
        message: `还有 ${readiness.missingStrips.length} 段没拼段图（${titles}）；先在配图步骤把全部段图拼好，再来推送`
      };
    }
    if (readiness.residualBlocks.length && !force) {
      const previews = readiness.residualBlocks
        .slice(0, 3)
        .map((block) => `「${block.content.slice(0, 20)}」`)
        .join("、");
      return {
        kind: "residual_text",
        message: `有 ${readiness.residualBlocks.length} 个块不属于任何分镜段（${previews}${readiness.residualBlocks.length > 3 ? " 等" : ""}）；把它们并入分镜文案或删除后再推，或勾选「强制重新推送」将其保留为段图之间的图文`
      };
    }
  } else {
    const hasText = article.blocks.some((block) => block.type !== "image");
    if (!hasText) return { kind: "no_content" };
  }

  const coverAsset = assets.find(
    (asset) => asset.type === "cover" && asset.status === "generated" && asset.filePath
  );
  if (!coverAsset) {
    return {
      kind: "no_cover",
      message: "还没有已生成的封面图：先在配图步骤生成封面（第一个封面配图），再推送草稿"
    };
  }

  const readAssetFile =
    dependencies.readAssetFile ?? assetToDraftImage;
  const imageBlockIds = new Set(
    article.blocks.filter((block) => block.type === "image").map((block) => block.content)
  );
  const inlineAssets = assets.filter(
    (asset) =>
      asset.status === "generated" &&
      asset.filePath &&
      imageBlockIds.has(`/api/image-assets/${asset.id}/content`)
  );

  const contentHtml = stripFlow
    ? renderWechatStripFlowHtml(article.blocks, assets, themeId, {
        // 走到这里时 residualBlocks 非空必然是 force 放行：残留块按作者意愿保留。
        includeResidualText: readiness.residualBlocks.length > 0
      })
    : renderWechatHtml(article.blocks, themeId);
  // 纯段图正文没有文字可让微信抓摘要，必须显式给；旧流留空维持微信默认行为。
  const digest = stripFlow && readiness.suggestedDigest ? readiness.suggestedDigest : undefined;
  const contentHash = articleDraftHash(article.id, contentHtml);
  const history = await dependencies.records.listByArticle(article.id);
  const duplicate = force ? undefined : history.find((record) => record.contentHash === contentHash);
  if (duplicate) return { kind: "duplicate", record: duplicate };

  try {
    const cover = await readAssetFile(coverAsset);
    const inlineImages: WechatDraftImage[] = [];
    for (const asset of inlineAssets) {
      inlineImages.push(await readAssetFile(asset));
    }
    const result = await dependencies.publisher.publish({
      title: article.title,
      contentHtml,
      cover,
      inlineImages,
      ...(digest ? { digest } : {})
    });
    const record: ArticleDraftPushRecord = {
      id: crypto.randomUUID(),
      articleId: article.id,
      mediaId: result.mediaId,
      title: article.title,
      themeId,
      contentHash,
      createdAt: (dependencies.now ?? (() => new Date()))().toISOString()
    };
    await dependencies.records.save(record);
    return { kind: "saved", record, replacements: result.imageReplacements };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") || message.includes("没有本地文件")) {
      return { kind: "missing_files", message: `配图文件读取失败：${message.slice(0, 160)}` };
    }
    return { kind: "publisher_error", message: message.slice(0, 300) };
  }
}
