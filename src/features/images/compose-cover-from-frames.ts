import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { Article } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import type { ImageAssetRepository } from "./repository";

/**
 * 「三帧横拼」封面：把文章里已生成的分镜帧横向拼成一张 2.35:1 的公众号首图。
 *
 * 为什么不是再让生图模型画一张：帧已经是定稿的漫画画面，三格并排天然就是
 * 「这篇文章讲了什么」的预览，观感与正文完全一致；AI 重画一张反而引入新的
 * 风格漂移。拼接是 CPU 活（sharp），不需要生图服务，没配生图能力的文章也能用。
 *
 * 落库流水线与 AI 生成同款（ensureCover 幂等建槽位 → beginGeneration 占位 →
 * completeGeneration 落结果），区别只在「图是拼出来的不是模型画的」。
 * 已有的 AI 封面会被覆盖，但它的旧版本仍在素材库里可以找回。
 */

/** 拼接画布：2.35:1（公众号首图比例），1440 宽保证缩略图后仍清晰。 */
export const COMPOSED_COVER_WIDTH = 1440;
export const COMPOSED_COVER_HEIGHT = 613;
/**
 * 白边：画布四周留白 + 格间距。帧不铺满整张画布——三格顶天立地显得挤，
 * 缩小一点、露出白底才有「三张卡片并排」的呼吸感（2026-09-21 用户反馈）。
 */
export const COMPOSED_COVER_MARGIN = 48;
export const COMPOSED_COVER_GUTTER = 28;
/** 每一格的宽高：画布去掉四周白边与格间距后三等分。帧按 cover 模式居中裁剪填充。 */
export const COMPOSED_COVER_CELL_WIDTH = Math.round(
  (COMPOSED_COVER_WIDTH - COMPOSED_COVER_MARGIN * 2 - COMPOSED_COVER_GUTTER * 2) / 3
);
const CELL_HEIGHT = COMPOSED_COVER_HEIGHT - COMPOSED_COVER_MARGIN * 2;
/** 第 index 格的落位（画布左上角原点）：末格右侧自然余出 ≈MARGIN 的白边。 */
function cellLeft(index: number) {
  return COMPOSED_COVER_MARGIN + index * (COMPOSED_COVER_CELL_WIDTH + COMPOSED_COVER_GUTTER);
}

export type ComposeCoverFromFramesResult =
  | { kind: "saved"; article: Article; assets: ImageAsset[] }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | {
      kind: "not_enough_frames";
      message: string;
      /** 失败时带上回灌状态（此时封面可能已被 ensureCover 建出），防 409 死锁。 */
      article?: Article;
      assets?: ImageAsset[];
    }
  | {
      kind: "compose_error";
      message: string;
      /** 失败也落库（封面置 failed 并推进文章版本），带回落库后的最新状态防 409 死锁。 */
      article?: Article;
      assets?: ImageAsset[];
    };

export interface ComposeCoverFromFramesInput {
  articleId: string;
  expectedUpdatedAt: string;
  /**
   * 指定三张帧资产 id（按左中右顺序）；缺省按段落顺序取前三张已生成分镜帧。
   * 传入的 id 必须都是本文已生成且落了盘的帧，否则报 not_enough_frames。
   */
  assetIds?: string[];
}

export interface ComposeCoverFromFramesDependencies {
  images: ImageAssetRepository;
  /** 拼接产物的落盘目录（默认 .data/generated-images，与 AI 生成同库）。 */
  storageDir?: string;
}

function isUsableFrame(asset: ImageAsset) {
  return asset.type === "storyboard" && asset.status === "generated" && Boolean(asset.filePath);
}

type BeginResult = Awaited<ReturnType<ImageAssetRepository["beginGeneration"]>>;

function mapMutation(
  result: Exclude<BeginResult, { kind: "saved" }>
): { kind: "not_found" } | { kind: "conflict" } | { kind: "compose_error"; message: string } {
  if (result.kind === "not_found") return { kind: "not_found" };
  if (result.kind === "conflict") return { kind: "conflict" };
  return {
    kind: "compose_error",
    message: result.kind === "invalid_state" ? result.message : "封面状态无效，请刷新后重试"
  };
}

export async function composeCoverFromFrames(
  input: ComposeCoverFromFramesInput,
  dependencies: ComposeCoverFromFramesDependencies
): Promise<ComposeCoverFromFramesResult> {
  // 1. 幂等建封面槽位（已有封面原样返回，不会覆盖作者写好的提示词）。
  const ensured = await dependencies.images.ensureCover(input.articleId, input.expectedUpdatedAt, {
    aspectRatio: "cover"
  });
  if (ensured.kind === "not_found") return { kind: "not_found" };
  if (ensured.kind === "conflict") return { kind: "conflict" };
  const cover = ensured.asset;

  // 2. 选帧：指定 id 按指定顺序；缺省按分镜权威顺序（段 order → 段内 frameAssetIds
  //    数组顺序，与段图拼接同源）取前三张已生成帧——资产本身没有顺序字段。
  const assets = ensured.assets;
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  let frames: ImageAsset[];
  if (input.assetIds?.length) {
    if (input.assetIds.length !== 3) {
      return {
        kind: "not_enough_frames",
        message: "横拼封面需要恰好 3 张帧图",
        article: ensured.article,
        assets
      };
    }
    frames = input.assetIds
      .map((assetId) => assetById.get(assetId))
      .filter((asset): asset is ImageAsset => Boolean(asset && isUsableFrame(asset)));
    if (frames.length !== 3) {
      return {
        kind: "not_enough_frames",
        message: "指定的帧图里有未生成或不存在于本文的图，请刷新后重试",
        article: ensured.article,
        assets
      };
    }
  } else {
    const segments = [...(ensured.article.planning.storyboardSegments ?? [])].sort(
      (left, right) => left.order - right.order
    );
    const orderedIds = segments.flatMap((segment) => segment.frameAssetIds);
    frames = orderedIds
      .map((id) => assetById.get(id))
      .filter((asset): asset is ImageAsset => Boolean(asset && isUsableFrame(asset)))
      .slice(0, 3);
  }
  if (frames.length < 3) {
    return {
      kind: "not_enough_frames",
      message: "文章里已生成的分镜帧不足 3 张，先把帧图生成出来再拼封面",
      article: ensured.article,
      assets
    };
  }

  // 3. 占位 generating（推进文章版本，防并发重复点击）。
  const begin = await dependencies.images.beginGeneration(
    input.articleId,
    cover.id,
    ensured.article.updatedAt
  );
  if (begin.kind !== "saved") return mapMutation(begin);

  const generationId = randomUUID();
  let filePath: string | null = null;
  try {
    // 4. sharp 横拼：每帧按 cover 模式居中裁剪到格宽×格高，四周留白边、格间留缝。
    const cellBuffers = await Promise.all(
      frames.map(async (frame) => {
        const binary = await readFile(resolve(frame.filePath!));
        return sharp(binary)
          .resize(COMPOSED_COVER_CELL_WIDTH, CELL_HEIGHT, { fit: "cover" })
          .png()
          .toBuffer();
      })
    );
    const composed = await sharp({
      create: {
        width: COMPOSED_COVER_WIDTH,
        height: COMPOSED_COVER_HEIGHT,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .composite(
        cellBuffers.map((buffer, index) => ({
          input: buffer,
          left: cellLeft(index),
          top: COMPOSED_COVER_MARGIN
        }))
      )
      .png()
      .toBuffer();

    const directory = resolve(
      dependencies.storageDir ?? resolve(process.cwd(), ".data", "generated-images")
    );
    await mkdir(directory, { recursive: true });
    // 文件名由服务端 id 构成；带 generationId：重拼写新文件，旧版本留在磁盘可回溯。
    filePath = resolve(directory, `${cover.id}-${generationId}.png`);
    await writeFile(filePath, composed);

    // 5. 落库：置 generated + filePath，与 AI 生成同一条完成通道。
    const completed = await dependencies.images.completeGeneration(
      input.articleId,
      cover.id,
      begin.article.updatedAt,
      { publicUrl: null, filePath, generationId }
    );
    if (completed.kind !== "saved") return mapMutation(completed);
    return { kind: "saved", article: completed.article, assets: completed.assets };
  } catch (error) {
    const message = error instanceof Error ? error.message : "封面拼接失败";
    // 失败也落库（封面置 failed 并推进版本），带最新状态给前端回灌，避免下一次 409 死锁。
    const failed = await dependencies.images.failGeneration(
      input.articleId,
      cover.id,
      begin.article.updatedAt
    );
    if (failed.kind !== "saved") return mapMutation(failed);
    return {
      kind: "compose_error",
      message: `封面拼接失败：${message}`,
      article: failed.article,
      assets: failed.assets
    };
  }
}
