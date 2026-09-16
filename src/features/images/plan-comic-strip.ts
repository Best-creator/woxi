import type { BlockType, ContentBlock } from "@/features/articles/domain";
import type { ComicStripMode, ConsumedContent, ImageAsset } from "./domain";

/**
 * 从正文里认出「分镜组」，并算出每种排法下长图里块的顺序。
 *
 * 这里是纯函数，因为它承担的是**排版规则**：哪几块图配哪段字、哪些正文要被替换掉。
 * 一旦掺进 sharp 或文件读写，规则就没法单独测，而规则恰恰是最容易出错的部分。
 */

/**
 * 会被长图吃掉、烘进图里的块类型。
 *
 * knowledge_card 故意不在其中：它是收尾的行动清单，是可被复制、被引用的文本，
 * 烘进像素图里反而没法用了——所以它留在正文里，跟在长图后面。
 */
const CONSUMABLE_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "heading",
  "paragraph",
  "quote",
  "callout"
]);

export interface ComicStripPanel {
  /** 分镜标题（段落没有标题时为 null）。 */
  title: string | null;
  /** 这一格的文案；对白、旁白已经并进这一句里。 */
  caption: string;
  /** 这一格用的配图。 */
  asset: ImageAsset;
  /** 组成这一格的正文块 id（含标题块）。 */
  blockIds: string[];
}

export interface ComicStripGroup {
  panels: ComicStripPanel[];
  /** 长图落在正文里的位置：第一个被替换掉的块。 */
  anchorBlockId: string;
  /** 被长图替换掉的正文快照，带恢复位置，取消长图时原样放回。 */
  consumedContent: ConsumedContent;
}

interface Segment {
  heading: ContentBlock | null;
  blocks: ContentBlock[];
}

function segmentBlocks(blocks: readonly ContentBlock[]): Segment[] {
  const ordered = [...blocks]
    .filter((block) => block.type !== "image")
    .sort((left, right) => left.order - right.order);
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const block of ordered) {
    if (block.type === "heading") {
      current = { heading: block, blocks: [block] };
      segments.push(current);
      continue;
    }
    // 第一个 heading 之前的导语自成一格：它没有分镜标题，也不该被硬塞进后面那一格。
    if (!current) {
      current = { heading: null, blocks: [] };
      segments.push(current);
    }
    current.blocks.push(block);
  }
  return segments;
}

function imageAssetsOf(segment: Segment, assets: readonly ImageAsset[]): ImageAsset[] {
  const blockIds = new Set(segment.blocks.map((block) => block.id));
  return assets.filter(
    (asset) =>
      // 长图不嵌套长图；封面没有正文锚点，天然落在所有格之外。
      !asset.consumedContent &&
      asset.type !== "cover" &&
      asset.status !== "disabled" &&
      Boolean(asset.anchorBlockId) &&
      blockIds.has(asset.anchorBlockId as string)
  );
}

function captionOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type !== "heading" && block.type !== "knowledge_card")
    .map((block) => block.content.trim())
    .filter(Boolean)
    // 块之间用空行分隔而不是空格：它们本来是两个句子，挤成一行会读成一句。
    .join("\n");
}

/**
 * 认出所有分镜组。一个分镜组 = 连续的若干格分镜。
 *
 * 遇到没有配图的段落就断开：那说明这一段的画面还没规划，或者作者本来就把它当正文写。
 * 正文头部没有标题的导语同样留在正文里，长图从第一张分镜图开始。
 */
export function planComicStrips(
  blocks: readonly ContentBlock[],
  assets: readonly ImageAsset[]
): ComicStripGroup[] {
  const segments = segmentBlocks(blocks).map((segment) => ({
    segment,
    assets: imageAssetsOf(segment, assets)
  }));

  const groups: ComicStripGroup[] = [];
  let panels: ComicStripPanel[] = [];
  let consumed: ContentBlock[] = [];

  // resumeBefore：长图撤掉后原文插回哪一块之前。null 表示这一组一直排到正文末尾。
  const flush = (resumeBefore: ContentBlock | null) => {
    if (panels.length && consumed.length) {
      groups.push({
        panels,
        anchorBlockId: consumed[0].id,
        consumedContent: {
          blocks: [...consumed],
          resumeBeforeBlockId: resumeBefore?.id ?? null
        }
      });
    }
    panels = [];
    consumed = [];
  };

  for (const { segment, assets: segmentAssets } of segments) {
    if (segmentAssets.length) {
      panels.push({
        title: segment.heading?.content.trim() ?? null,
        caption: captionOf(segment.blocks),
        asset: segmentAssets[0],
        blockIds: segment.blocks.map((block) => block.id)
      });
      consumed.push(...segment.blocks.filter((block) => CONSUMABLE_BLOCK_TYPES.has(block.type)));
      continue;
    }
    flush(segment.heading);
  }
  // 一直排到结尾的那一组：没有后继块，恢复时追加到正文末尾。
  flush(null);

  return groups;
}

/** 长图里的一块：要用哪张图，或者要写哪段字。顺序就是最终长图从上到下的顺序。 */
export type ComicStripPiece =
  | { kind: "image"; panel: ComicStripPanel }
  | { kind: "text"; title: string | null; body: string };

function textPiece(panels: readonly ComicStripPanel[]): ComicStripPiece {
  const titles = panels
    .map((panel) => panel.title)
    .filter((title): title is string => Boolean(title));
  return {
    kind: "text",
    title: titles.length ? titles.join(" · ") : null,
    body: panels
      .map((panel) => panel.caption)
      .filter(Boolean)
      .join("\n")
  };
}

/**
 * 按用户选的排法，把一个分镜组摊成自上而下的一串块。
 *
 * - image_text：一格一图一文，文跟在图后面
 * - text_image：文在前、图在后，先铺垫再给画面
 * - image_text_image：两图夹一文——分镜两两成组，文案落在两张图正中间；
 *   落单的最后一格退化成「图 + 文」，不会凭空少一格
 */
export function layoutComicStrip(
  group: ComicStripGroup,
  mode: ComicStripMode
): ComicStripPiece[] {
  const { panels } = group;
  const pieces: ComicStripPiece[] = [];

  if (mode === "image_text_image") {
    for (let index = 0; index < panels.length; index += 2) {
      const pair = [panels[index], panels[index + 1]].filter(
        (panel): panel is ComicStripPanel => Boolean(panel)
      );
      pieces.push({ kind: "image", panel: pair[0] });
      pieces.push(textPiece(pair));
      if (pair[1]) pieces.push({ kind: "image", panel: pair[1] });
    }
    return pieces;
  }

  for (const panel of panels) {
    const image: ComicStripPiece = { kind: "image", panel };
    const text = textPiece([panel]);
    if (mode === "text_image") pieces.push(text, image);
    else pieces.push(image, text);
  }
  return pieces;
}

/** 一张长图至少要两格才谈得上「拼」：单格用普通配图就行，不必多一层长图。 */
export const MIN_COMIC_STRIP_PANELS = 2;

export interface ComicStripReadiness {
  /** 够格拼成长图的分镜组（每组至少两格）。 */
  groups: ComicStripGroup[];
  /** 认出来的分镜格总数（含只有一格、拼不成组的）。 */
  panelCount: number;
  /** 还差几格才能拼；已经够了就是 0。 */
  missingPanels: number;
}

/**
 * 界面用它决定入口显不显示、以及该提示什么。
 * 和真正合成走同一套识别逻辑，避免「按钮亮着但点了说拼不了」。
 */
export function inspectComicStrip(
  blocks: readonly ContentBlock[],
  assets: readonly ImageAsset[]
): ComicStripReadiness {
  const all = planComicStrips(blocks, assets);
  const groups = all.filter((group) => group.panels.length >= MIN_COMIC_STRIP_PANELS);
  const panelCount = all.reduce((total, group) => total + group.panels.length, 0);

  return {
    groups,
    panelCount,
    missingPanels: Math.max(0, MIN_COMIC_STRIP_PANELS - panelCount)
  };
}
