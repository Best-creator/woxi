import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  STORYBOARD_ROUTE_LABELS,
  storyboardFrameCount,
  type Article,
  type ContentBlock,
  type StoryboardRoute,
  type StoryboardSegment
} from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import {
  DEFAULT_COMIC_STRIP_METRICS,
  composeComicStrip,
  type ComicStripBlock,
  type ComicStripMetrics,
  type ComicStripTextBlock
} from "./comic-strip";
import { withStripsRestored } from "./consumed-content";
import { resolveStoryboardFont, type ImageAsset } from "./domain";
import { removeGenerationFile } from "./generation-files";
import { CONSUMABLE_BLOCK_TYPES } from "./plan-comic-strip";
import type { ImageAssetRepository, SaveComicStripInput } from "./repository";

/**
 * 分段拼接：把第三步「设计正文分镜」产出的每个段落，各自拼成一张段图。
 *
 * 与旧漫画长图（compose-comic-strip）的差异：
 * - 认组不再靠「块角色 + 锚点图」猜，而是直接消费 planning.storyboardSegments——
 *   段的边界、路由、帧引用在设计期就定了，拼接只负责执行；
 * - 每段一张图（该段的分镜帧 + 该段文案），不是整篇一条超长图；
 * - 文案字体由作者挑选（planning.storyboardFontId），烘进图里即成稿。
 *
 * 与旧链路共享的机制一个都没动：替换语义（consumedContent 快照）、
 * 乐观锁链、先删旧图再拼新的顺序。落库走 saveComicStripsBatch——
 * 相邻段没有间隔块，必须整批一次合并才能保证段图按正文顺序落位；
 * 取消段图也不用新接口——旧漫画长图的 DELETE 会把本篇所有 comic_strip
 * 撤掉并放回正文，对段图同样成立。
 */

export interface SegmentStripOutcome {
  segmentId: string;
  /** 段落小标题（设计期命名），界面回显用。 */
  title: string;
  route: StoryboardRoute;
  assetId: string;
  width: number;
  height: number;
  frames: number;
}

export type ComposeSegmentStripsResult =
  | {
      kind: "composed";
      article: Article;
      assets: ImageAsset[];
      strips: SegmentStripOutcome[];
      fontFamily: string;
    }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready"; message: string }
  | { kind: "compose_error"; message: string };

export interface ComposeSegmentStripsInput {
  articleId: string;
  expectedUpdatedAt: string;
  /** 本次拼接使用的字体 id（STORYBOARD_FONT_OPTIONS）；传入即持久化进 planning，缺省沿用已存选择。 */
  fontId?: string | null;
}

export interface ComposeSegmentStripsDependencies {
  articles: ArticleRepository;
  images: ImageAssetRepository;
  /** 段图落盘目录（默认 .data/generated-images），测试可注入临时目录。 */
  storageDir?: string;
  /** 基准排版参数；fontFamily 恒由字体选择决定，注入值会被覆盖。 */
  metrics?: ComicStripMetrics;
}

function byOrder(left: ContentBlock, right: ContentBlock): number {
  return left.order - right.order;
}

/**
 * 段内文案拆成文字带：每个文案块一条带（标题块当首条带的 title），块与块之间由
 * 渲染器的 gap 自然隔开——短卡节奏，读者一眼一行。历史文章（标题 + 单段落）
 * 切出来还是一条带，视觉与旧版完全一致。
 */
export function stripTextBandsOf(
  segment: StoryboardSegment,
  copyBlocks: readonly ContentBlock[]
): ComicStripTextBlock[] {
  const heading = copyBlocks.find((block) => block.type === "heading");
  const title = heading?.content.trim() || segment.title.trim() || "";
  const bodies = copyBlocks
    .filter((block) => block.type !== "heading" && CONSUMABLE_BLOCK_TYPES.has(block.type))
    .map((block) => block.content.trim())
    .filter(Boolean);
  if (!bodies.length) {
    return title ? [{ kind: "text", title, body: "" }] : [];
  }
  return bodies.map((body, index) => ({
    kind: "text" as const,
    ...(index === 0 && title ? { title } : {}),
    body
  }));
}

/** 数一遍所有段还差几帧真实图片（资产缺失 / 未生成 / 无落盘文件都算差）。 */
function pendingFrameCount(
  segments: readonly StoryboardSegment[],
  assetById: ReadonlyMap<string, ImageAsset>
): number {
  return segments.reduce((total, segment) => {
    const required = storyboardFrameCount(segment.route);
    const ready = segment.frameAssetIds
      .slice(0, required)
      .filter((id) => {
        const asset = assetById.get(id);
        return asset && asset.status === "generated" && Boolean(asset.filePath);
      }).length;
    return total + (required - ready);
  }, 0);
}

/**
 * 按设计把每段拼成段图。
 *
 * 顺序沿用旧长图验证过的那条铁律：**先在还原后的视图上校验，全部通过才动手改库**——
 * - 认文案块要在「旧段图撤掉之后」的正文视图上做（withStripsRestored），
 *   段图挂着的时候文案块是隐身的，直接在当前正文上找会把「重拼一次」误判成「没有分镜」；
 * - 校验不过就返回，作者已有的段图一张不少；
 * - 校验全过才持久化字体选择、撤旧图、拼新图，每一步都推进乐观锁。
 */
export async function composeSegmentStrips(
  input: ComposeSegmentStripsInput,
  dependencies: ComposeSegmentStripsDependencies
): Promise<ComposeSegmentStripsResult> {
  const article = await dependencies.articles.findById(input.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== input.expectedUpdatedAt) return { kind: "conflict" };

  const segments = [...(article.planning.storyboardSegments ?? [])].sort(
    (left, right) => left.order - right.order
  );
  if (!segments.length) {
    return {
      kind: "not_ready",
      message: "这篇正文还没有分镜设计，先在第三步「设计正文分镜」生成设计，再来拼接段图"
    };
  }

  const assets = await dependencies.images.list(article.id);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const restoredBlocks = withStripsRestored(article.blocks, assets);
  const textBlocks = restoredBlocks.filter((block) => block.type !== "image").sort(byOrder);
  const blockById = new Map(textBlocks.map((block) => [block.id, block]));

  const pendingFrames = pendingFrameCount(segments, assetById);
  if (pendingFrames > 0) {
    return {
      kind: "not_ready",
      message: `还有 ${pendingFrames} 帧分镜没生成图片；先把图补齐，再来拼接段图`
    };
  }

  interface PreparedSegment {
    segment: StoryboardSegment;
    frameAssets: ImageAsset[];
    consumedBlocks: ContentBlock[];
    resumeBeforeBlockId: string | null;
    textBands: ComicStripTextBlock[];
  }

  // 所有段会被吃掉的块先并成一个大集合：相邻段的「插回位置」必须落在
  // 没人吃的块上——如果落在别的段要吃的块上，那段图也隐身了，还原时定位不到。
  const consumedEverywhere = new Set<string>();
  for (const segment of segments) {
    for (const blockId of segment.copyBlockIds) {
      const block = blockById.get(blockId);
      if (block && CONSUMABLE_BLOCK_TYPES.has(block.type)) consumedEverywhere.add(block.id);
    }
  }

  const prepared: PreparedSegment[] = [];
  for (const segment of segments) {
    const frameAssets = segment.frameAssetIds
      .slice(0, storyboardFrameCount(segment.route))
      .map((id) => assetById.get(id))
      .filter((asset): asset is ImageAsset => Boolean(asset));

    const consumedBlocks = segment.copyBlockIds
      .map((id) => blockById.get(id))
      .filter(
        (block): block is ContentBlock =>
          block !== undefined && CONSUMABLE_BLOCK_TYPES.has(block.type)
      )
      .sort(byOrder);
    if (!consumedBlocks.length) {
      return {
        kind: "not_ready",
        message: `段落「${segment.title}」的成稿文案不在正文里，可能已被删除；请重新设计分镜`
      };
    }

    const lastConsumed = consumedBlocks[consumedBlocks.length - 1]!;
    const lastIndex = textBlocks.findIndex((block) => block.id === lastConsumed.id);
    const resumeBeforeBlockId =
      textBlocks
        .slice(lastIndex + 1)
        .find((block) => !consumedEverywhere.has(block.id))?.id ?? null;

    prepared.push({
      segment,
      frameAssets,
      consumedBlocks,
      resumeBeforeBlockId,
      textBands: stripTextBandsOf(segment, consumedBlocks)
    });
  }

  // 校验全过，才把本次的字体选择持久化：拒拼的请求不该白白推进版本号。
  const chosenFont = resolveStoryboardFont(input.fontId ?? article.planning.storyboardFontId);
  let currentArticle = article;
  let expectedUpdatedAt = input.expectedUpdatedAt;
  if ((article.planning.storyboardFontId ?? null) !== chosenFont.id) {
    const saved = await dependencies.articles.save(
      {
        ...currentArticle,
        planning: { ...currentArticle.planning, storyboardFontId: chosenFont.id }
      },
      expectedUpdatedAt
    );
    if (saved.kind !== "saved") return { kind: "conflict" };
    currentArticle = saved.article;
    expectedUpdatedAt = saved.article.updatedAt;
  }

  // 旧段图（含旧版漫画长图）先撤掉再拼：同一篇里留两张长图，谁替换了哪些块就是一笔糊涂账。
  for (const asset of assets.filter((candidate) => candidate.type === "comic_strip")) {
    const removed = await dependencies.images.removeComicStrip(
      currentArticle.id,
      asset.id,
      expectedUpdatedAt
    );
    if (removed.kind !== "saved") continue;
    await removeGenerationFile(removed.removedFilePath);
    currentArticle = removed.article;
    expectedUpdatedAt = removed.article.updatedAt;
  }

  const base = dependencies.metrics ?? DEFAULT_COMIC_STRIP_METRICS;
  const metrics: ComicStripMetrics = { ...base, fontFamily: chosenFont.fontFamily };
  const storageDir =
    dependencies.storageDir ?? resolve(process.cwd(), ".data", "generated-images");

  // 第一阶段：纯 CPU 的拼图，全部在内存完成，不碰库——任何一段失败都不留痕迹。
  const drafts: Array<{ input: SaveComicStripInput; outcome: SegmentStripOutcome; filePath: string }> = [];
  try {
    for (const entry of prepared) {
      const binaries: Buffer[] = [];
      for (const frame of entry.frameAssets) {
        binaries.push(await readFile(frame.filePath!));
      }

      // 段内路由在设计期就定了：图+文 / 文+图 / 图+文+图，两图夹一文时帧序即设计序。
      // 文案按块拆成多条文字带——每块一条短卡，不再是一整段长文。
      const stripBlocks: ComicStripBlock[] =
        entry.segment.route === "text_image"
          ? [...entry.textBands, { kind: "image", binary: binaries[0]! }]
          : entry.segment.route === "image_text_image"
            ? [
                { kind: "image", binary: binaries[0]! },
                ...entry.textBands,
                { kind: "image", binary: binaries[1]! }
              ]
            : [{ kind: "image", binary: binaries[0]! }, ...entry.textBands];

      const { buffer, width, height } = await composeComicStrip(stripBlocks, metrics);

      const assetId = randomUUID();
      const generationId = randomUUID();
      await mkdir(storageDir, { recursive: true });
      const filePath = resolve(storageDir, `${assetId}-${generationId}.png`);
      await writeFile(filePath, buffer);

      drafts.push({
        filePath,
        outcome: {
          segmentId: entry.segment.id,
          title: entry.segment.title,
          route: entry.segment.route,
          assetId,
          width,
          height,
          frames: entry.frameAssets.length
        },
        input: {
          assetId,
          generationId,
          // 段内路由与长图排法共用同一套取值，仓储侧原样落库。
          mode: entry.segment.route,
          anchorBlockId: entry.consumedBlocks[0]!.id,
          consumedContent: {
            blocks: entry.consumedBlocks.map((block) => ({ ...block })),
            resumeBeforeBlockId: entry.resumeBeforeBlockId
          },
          altText: `${currentArticle.title}｜段图｜${entry.segment.title}`,
          purpose: `分段长图｜${entry.segment.title}｜${STORYBOARD_ROUTE_LABELS[entry.segment.route]}`,
          filePath
        }
      });
    }
  } catch (error) {
    return {
      kind: "compose_error",
      message: error instanceof Error ? `拼接失败：${error.message}` : "拼接失败，请重试"
    };
  }

  // 第二阶段：整批一次落库。相邻段之间没有间隔块，逐张落库时前一张的插回位置
  // 会落在后一张要吃的块上、合并顺序错乱——批量插入只合并一次，锚点先后即成图顺序。
  const saved = await dependencies.images.saveComicStripsBatch(
    currentArticle.id,
    expectedUpdatedAt,
    drafts.map((draft) => draft.input)
  );
  if (saved.kind !== "saved") {
    // 数据库没收下这批图，刚写的文件全是孤儿。
    for (const draft of drafts) await removeGenerationFile(draft.filePath);
  }
  if (saved.kind === "not_found") return { kind: "not_found" };
  if (saved.kind === "conflict") return { kind: "conflict" };
  if (saved.kind !== "saved") {
    return {
      kind: "compose_error",
      message:
        saved.kind === "invalid_state" || saved.kind === "invalid_anchor"
          ? "正文已经变了，段图没能插回去，请重试"
          : "段图保存失败，请重试"
    };
  }

  return {
    kind: "composed",
    article: saved.article,
    assets: saved.assets,
    strips: drafts.map((draft) => draft.outcome),
    fontFamily: chosenFont.fontFamily
  };
}
