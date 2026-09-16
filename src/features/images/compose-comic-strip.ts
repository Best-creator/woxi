import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Article } from "@/features/articles/domain";
import type { ArticleRepository } from "@/features/articles/repository";
import { DEFAULT_COMIC_STRIP_METRICS, composeComicStrip, type ComicStripBlock, type ComicStripMetrics } from "./comic-strip";
import {
  HeuristicComicStripModeRouter,
  type ComicStripModeDecision,
  type ComicStripModeRouter
} from "./comic-strip-mode-router";
import { withStripsRestored } from "./consumed-content";
import { isComicStripMode, type ComicStripMode, type ComicStripModeChoice, type ImageAsset } from "./domain";
import { removeGenerationFile } from "./generation-files";
import {
  inspectComicStrip,
  layoutComicStrip,
  type ComicStripGroup
} from "./plan-comic-strip";
import type { ImageAssetRepository } from "./repository";

export interface ComicStripOutcome {
  assetId: string;
  width: number;
  height: number;
  panels: number;
  /** 实际使用的排法：auto 决策或手动指定都会写进这里，供界面回显。 */
  mode: ComicStripMode;
  reason: string;
}

export type ComposeComicStripsResult =
  | { kind: "composed"; article: Article; assets: ImageAsset[]; strips: ComicStripOutcome[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "not_ready"; message: string }
  | { kind: "compose_error"; message: string };

export interface ComposeComicStripsDependencies {
  articles: ArticleRepository;
  images: ImageAssetRepository;
  /** 长图落盘目录（默认 .data/generated-images），测试可注入临时目录。 */
  storageDir?: string;
  metrics?: ComicStripMetrics;
  /** mode 为 auto 时的排法路由；缺省用确定性规则，路由失败也回落到它。 */
  modeRouter?: ComicStripModeRouter;
}

/** 没生成图的分镜在长图里只能是一块「待生成」灰块——那还不如不做，至少正文还在。 */
function missingImageCount(group: ComicStripGroup): number {
  return group.panels.filter(
    (panel) => panel.asset.status !== "generated" || !panel.asset.filePath
  ).length;
}

function textExcerptOf(article: Article, limit = 600): string {
  const text = article.blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.content)
    .join("\n");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const fallbackRouter = new HeuristicComicStripModeRouter();

/** 读文章 planning 里的规划期排法决策：规划器设计分镜时一并给出，拼图阶段直接消费。 */
function plannedStripDecision(planning: Article["planning"]): ComicStripModeDecision | null {
  const mode = planning.comicStripMode;
  const reason = planning.comicStripReason;
  if (!isComicStripMode(mode)) return null;
  return {
    mode,
    reason: reason?.trim() ? reason.trim() : "规划分镜时确定"
  };
}

/**
 * 决定这一组分镜的排法。优先级：手动指定 > 规划期决策（深结合）> 模型路由 > 确定性规则。
 * 排法选得不完美只影响观感，任何一层失败都不该让拼图挂掉。
 */
async function decideGroupMode(
  group: ComicStripGroup,
  mode: ComicStripModeChoice,
  planned: ComicStripModeDecision | null,
  excerpt: string,
  router: ComicStripModeRouter | undefined
): Promise<ComicStripModeDecision> {
  if (mode !== "auto") return { mode, reason: "手动指定" };
  if (planned) {
    return { ...planned, reason: `${planned.reason}（规划分镜时确定）` };
  }

  const input = {
    panels: group.panels.map((panel) => ({
      title: panel.title,
      caption: panel.caption,
      chars: panel.caption.replace(/\s/g, "").length
    })),
    excerpt
  };
  try {
    return await (router ?? fallbackRouter).decide(input);
  } catch {
    const fallback = await fallbackRouter.decide(input);
    return { ...fallback, reason: `${fallback.reason}（模型不可用，按规则选择）` };
  }
}

async function panelBinary(asset: ImageAsset): Promise<Buffer> {
  if (!asset.filePath) throw new Error("分镜图还没有落盘文件");
  return readFile(asset.filePath);
}

function toComicStripBlocks(
  group: ComicStripGroup,
  mode: ComicStripMode,
  binaries: Map<string, Buffer>
): ComicStripBlock[] {
  return layoutComicStrip(group, mode).map((piece) =>
    piece.kind === "image"
      ? { kind: "image" as const, binary: binaries.get(piece.panel.asset.id) as Buffer }
      : { kind: "text" as const, ...(piece.title ? { title: piece.title } : {}), body: piece.body }
  );
}

/**
 * 把一篇文章里的分镜组拼成漫画长图。
 *
 * 顺序是「先认分镜、再删旧图、最后拼新的」：
 * - 认分镜要在正文还原后的视图上做（`withStripsRestored`），否则换排法时正文里只剩一张长图，认不出分镜；
 * - 删旧图放在校验之后，这样「拒拼」不会先把作者已有的长图毁掉；
 * - 旧图必须真的撤掉再拼，否则同一篇里留两张长图，「谁替换了哪些块」就成了一笔糊涂账。
 *
 * 不把拼图放进事务：它是 CPU 密集活、可能失败或超时，塞进事务会长时间锁库。
 * 每一步自己都是完整状态，失败时正文退回原样——比留着一张拼了一半的坏图更好。
 */
export async function composeComicStrips(
  input: { articleId: string; expectedUpdatedAt: string; mode: ComicStripModeChoice },
  dependencies: ComposeComicStripsDependencies
): Promise<ComposeComicStripsResult> {
  const article = await dependencies.articles.findById(input.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== input.expectedUpdatedAt) return { kind: "conflict" };

  const assets = await dependencies.images.list(article.id);
  const readiness = inspectComicStrip(withStripsRestored(article.blocks, assets), assets);
  if (!readiness.groups.length) {
    return {
      kind: "not_ready",
      message:
        readiness.panelCount === 0
          ? "这篇正文里还没有分镜配图，先规划并生成配图再来拼长图"
          : `至少要两格分镜才拼得成长图，现在只有 ${readiness.panelCount} 格`
    };
  }

  const incomplete = readiness.groups.reduce(
    (total, group) => total + missingImageCount(group),
    0
  );
  if (incomplete > 0) {
    return {
      kind: "not_ready",
      message: `还有 ${incomplete} 格分镜没生成图片；先把图补齐，再来拼长图`
    };
  }

  let expectedUpdatedAt = input.expectedUpdatedAt;
  let currentArticle = article;

  // 旧长图先撤掉并清文件：同一篇里留两张长图会让「谁替换了哪些块」变成一笔糊涂账。
  for (const asset of assets.filter((candidate) => candidate.type === "comic_strip")) {
    const removed = await dependencies.images.removeComicStrip(
      article.id,
      asset.id,
      expectedUpdatedAt
    );
    if (removed.kind !== "saved") continue;
    await removeGenerationFile(removed.removedFilePath);
    currentArticle = removed.article;
    expectedUpdatedAt = removed.article.updatedAt;
  }

  const storageDir =
    dependencies.storageDir ?? resolve(process.cwd(), ".data", "generated-images");
  const metrics = dependencies.metrics ?? DEFAULT_COMIC_STRIP_METRICS;
  const excerpt = textExcerptOf(currentArticle);
  const planned = plannedStripDecision(article.planning);
  const strips: ComicStripOutcome[] = [];

  try {
    for (const group of readiness.groups) {
      const decision = await decideGroupMode(
        group,
        input.mode,
        planned,
        excerpt,
        dependencies.modeRouter
      );
      const binaries = new Map<string, Buffer>();
      for (const panel of group.panels) {
        binaries.set(panel.asset.id, await panelBinary(panel.asset));
      }

      const { buffer, width, height } = await composeComicStrip(
        toComicStripBlocks(group, decision.mode, binaries),
        metrics
      );

      const assetId = randomUUID();
      const generationId = randomUUID();
      await mkdir(storageDir, { recursive: true });
      const filePath = resolve(storageDir, `${assetId}-${generationId}.png`);
      await writeFile(filePath, buffer);

      const saved = await dependencies.images.saveComicStrip(article.id, expectedUpdatedAt, {
        assetId,
        generationId,
        mode: decision.mode,
        anchorBlockId: group.anchorBlockId,
        // 深拷贝一份再落库：快照要和此刻的正文完全一致，不能被后续编辑串改。
        consumedContent: {
          blocks: group.consumedContent.blocks.map((block) => ({ ...block })),
          resumeBeforeBlockId: group.consumedContent.resumeBeforeBlockId
        },
        altText: `${currentArticle.title}｜漫画长图（${group.panels.length} 格）`,
        purpose: `漫画长图｜${group.panels.length} 格分镜｜${decision.mode}`,
        filePath
      });

      if (saved.kind === "not_found") return { kind: "not_found" };
      if (saved.kind === "conflict") return { kind: "conflict" };
      if (saved.kind !== "saved") {
        // 数据库没收下这张图，刚写的文件就是孤儿。
        await removeGenerationFile(filePath);
        return {
          kind: "compose_error",
          message:
            saved.kind === "invalid_state" || saved.kind === "invalid_anchor"
              ? "正文已经变了，长图没能插回去，请重试"
              : "长图保存失败，请重试"
        };
      }

      currentArticle = saved.article;
      expectedUpdatedAt = saved.article.updatedAt;
      strips.push({
        assetId,
        width,
        height,
        panels: group.panels.length,
        mode: decision.mode,
        reason: decision.reason
      });
    }
  } catch (error) {
    return {
      kind: "compose_error",
      message: error instanceof Error ? `拼图失败：${error.message}` : "拼图失败，请重试"
    };
  }

  const finalAssets = await dependencies.images.list(article.id);
  return { kind: "composed", article: currentArticle, assets: finalAssets, strips };
}

export type RemoveComicStripsResult =
  | { kind: "removed"; article: Article; assets: ImageAsset[]; removed: number }
  | { kind: "not_found" }
  | { kind: "conflict" };

/**
 * 撤掉这篇里所有长图，正文回到原来的分镜图文。
 * 正文块从头到尾没被删过，所以这里不需要重建任何内容。
 */
export async function removeComicStrips(
  input: { articleId: string; expectedUpdatedAt: string },
  dependencies: Pick<ComposeComicStripsDependencies, "articles" | "images">
): Promise<RemoveComicStripsResult> {
  const article = await dependencies.articles.findById(input.articleId);
  if (!article) return { kind: "not_found" };
  if (article.updatedAt !== input.expectedUpdatedAt) return { kind: "conflict" };

  const assets = await dependencies.images.list(article.id);
  const strips = assets.filter((asset) => asset.type === "comic_strip");
  if (!strips.length) {
    return { kind: "removed", article, assets, removed: 0 };
  }

  let currentArticle = article;
  let expectedUpdatedAt = input.expectedUpdatedAt;
  let removed = 0;
  for (const asset of strips) {
    const result = await dependencies.images.removeComicStrip(
      article.id,
      asset.id,
      expectedUpdatedAt
    );
    if (result.kind !== "saved") continue;
    await removeGenerationFile(result.removedFilePath);
    currentArticle = result.article;
    expectedUpdatedAt = result.article.updatedAt;
    removed += 1;
  }

  return {
    kind: "removed",
    article: currentArticle,
    assets: await dependencies.images.list(article.id),
    removed
  };
}
