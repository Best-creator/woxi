import type { ContentBlock } from "@/features/articles/domain";

export type ImageAssetType =
  | "cover"
  | "storyboard"
  | "concept"
  | "process"
  | "comparison"
  | "knowledge_card"
  | "comic_strip";

/**
 * 长图把「分镜图 + 中间的文字」拼成一张图的三种排法。
 *
 * - image_text：一格图，下面跟这一格的文案
 * - text_image：文案在上、图在下，先铺垫再给画面
 * - image_text_image：两图夹一文——分镜两两成组，文案落在两张图正中间，最像连环画
 */
export type ComicStripMode = "image_text" | "text_image" | "image_text_image";

export const COMIC_STRIP_MODES: readonly ComicStripMode[] = [
  "image_text",
  "text_image",
  "image_text_image"
];

export const COMIC_STRIP_MODE_LABELS: Record<ComicStripMode, string> = {
  image_text: "图 + 文",
  text_image: "文 + 图",
  image_text_image: "图 + 文 + 图"
};

/**
 * 拼图排法的选择：「auto」交给模型按正文内容自行决定（默认），
 * 具体排法是用户手动覆盖。路由决策见 `comic-strip-mode-router.ts`。
 */
export type ComicStripModeChoice = ComicStripMode | "auto";

export function isComicStripModeChoice(value: unknown): value is ComicStripModeChoice {
  return value === "auto" || isComicStripMode(value);
}

export function isComicStripMode(value: unknown): value is ComicStripMode {
  return typeof value === "string" && (COMIC_STRIP_MODES as readonly string[]).includes(value);
}

export type ImageAssetStatus =
  | "planned"
  | "placeholder"
  | "generating"
  | "generated"
  | "disabled"
  | "failed";

/**
 * 分镜帧的台词/旁白（剧情漫画形态）。
 *
 * 文字不进生图（D2/D3 红线），台词由拼接渲染器烘成图外的条块：
 * - dialogue（对白）：角色嘴里的短句，渲染成白底橙描边条，≤10 字；
 * - narration（旁白）：画外音吐槽，渲染成橙底条 + 固定头像位，≤25 字。
 * 存在帧资产上而不是正文块里：它是画面的附属品，重生成帧时随帧走。
 */
export type SpeechLineKind = "dialogue" | "narration";

export const SPEECH_LINE_KINDS: readonly SpeechLineKind[] = ["dialogue", "narration"];

export function isSpeechLineKind(value: unknown): value is SpeechLineKind {
  return typeof value === "string" && (SPEECH_LINE_KINDS as readonly string[]).includes(value);
}

export interface SpeechLine {
  kind: SpeechLineKind;
  text: string;
}

export type ImageAspectRatio = "cover" | "landscape" | "square" | "portrait";

export interface ImagePlanSuggestion {
  type: ImageAssetType;
  anchorBlockId: string | null;
  purpose: string;
  prompt: string;
  altText: string;
  aspectRatio: ImageAspectRatio;
}

/**
 * 漫画长图替换掉的正文。
 *
 * 存的是**内容快照**而不是块 id：正文合并后会把图块重新插回 blocks_json，
 * 被替换的块一旦从那里消失就再也找不回来。带着原文走，取消长图时才能原样放回去。
 */
export interface ConsumedContent {
  blocks: ContentBlock[];
  /** 放回正文时插在这一块之前；null 表示追加到正文末尾。 */
  resumeBeforeBlockId: string | null;
}

/**
 * 封面提示词的兜底草稿。
 *
 * 封面是公众号草稿的头图，是唯一一张「文章级」配图——没有它发布门直接拒推。
 * 作者没写提示词时用它兜底，避免把空提示词送进生图模型；界面上会把它填进
 * 输入框让作者接着改。放 domain 是为了让服务端与界面共用同一份措辞。
 */
export function defaultCoverPrompt(article: { title: string; topic: string }): string {
  const topic = article.topic?.trim() || article.title;
  return `微信公众号封面图：${article.title}。围绕主题「${topic}」，主体清晰、有视觉冲击力，适合作为文章头图，不要出现文字水印。`;
}

export interface ImageAsset extends ImagePlanSuggestion {
  id: string;
  articleId: string;
  status: ImageAssetStatus;
  placeholderUrl: string | null;
  filePath: string | null;
  publicUrl: string | null;
  manuallyEdited: boolean;
  /** 普通配图是 null；漫画长图带一份被它替换掉的正文快照，用于随时撤销。 */
  consumedContent: ConsumedContent | null;
  /**
   * 帧的台词/旁白，仅分镜帧（type=storyboard）会带；缺省/null = 没有台词，
   * 渲染时直接跳过——旧帧零迁移。
   */
  speechLine?: SpeechLine | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 一次真实生图的产物。
 *
 * 同一张配图可以保留多版：重生成不再覆盖上一张，而是新增一条记录，
 * 由作者在界面上选用。`ImageAsset.filePath/publicUrl` 始终镜像「当前选中的那一版」，
 * 所以正文块、content 路由、公众号发布这些下游消费者都不需要知道版本的存在。
 *
 * `selected` 只是这套镜像关系的冗余标记，方便界面直接标出「正在使用」。
 * 同一 assetId 下最多一条 selected = 1（由仓储在事务里保证）。
 */
export interface ImageGeneration {
  id: string;
  articleId: string;
  assetId: string;
  /** 生成时用的提示词快照：提示词事后被改过也能看出这一版是怎么来的。 */
  prompt: string;
  model: string | null;
  filePath: string | null;
  publicUrl: string | null;
  selected: boolean;
  createdAt: string;
}

/** 配图版本条/素材库条目在界面上的统一形态：带出处信息，便于跨槽位复用。 */
export interface ImageLibraryItem extends ImageGeneration {
  assetType: ImageAssetType;
  assetPurpose: string;
}

/**
 * 分段拼接的内置字体选项。
 *
 * 文案烘进段图后就是像素，字体必须在**本机渲染时**命中——所以只列 Windows / macOS
 * 自带、librsvg 能找到的中文系统字体，每个选项都带跨平台回落链。
 * 微信侧不再参与渲染：读者看到的就是这张图，所见即所得。
 */
export interface StoryboardFontOption {
  id: string;
  label: string;
  fontFamily: string;
}

export const DEFAULT_STORYBOARD_FONT_ID = "sans_default";

export const STORYBOARD_FONT_OPTIONS: readonly StoryboardFontOption[] = [
  {
    id: "sans_default",
    label: "默认黑体",
    fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif"
  },
  {
    id: "yahei",
    label: "微软雅黑",
    fontFamily: "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif"
  },
  {
    id: "dengxian",
    label: "等线",
    fontFamily: "'DengXian','PingFang SC','Microsoft YaHei',sans-serif"
  },
  {
    id: "simhei",
    label: "黑体",
    fontFamily: "'SimHei','PingFang SC','Microsoft YaHei',sans-serif"
  },
  {
    id: "simsun",
    label: "宋体",
    fontFamily: "'SimSun','Songti SC','Noto Serif CJK SC',serif"
  },
  {
    id: "kaiti",
    label: "楷体",
    fontFamily: "'KaiTi','Kaiti SC','STKaiti',serif"
  },
  {
    id: "fangsong",
    label: "仿宋",
    fontFamily: "'FangSong','STFangsong','FangSong_GB2312',serif"
  }
];

/** 解析字体选择：空值/未知 id 一律回落默认黑体，拼接不因一个字体 id 卡住。 */
export function resolveStoryboardFont(fontId?: string | null): StoryboardFontOption {
  const normalized = fontId?.trim() ?? "";
  return (
    STORYBOARD_FONT_OPTIONS.find((option) => option.id === normalized) ??
    (STORYBOARD_FONT_OPTIONS[0] as StoryboardFontOption)
  );
}

/**
 * 段图文字大小的档位。
 *
 * 段图在公众号里恒为 100% 宽显示，手机上约 340-400px，也就是 1080 的画布整体缩到
 * 约 0.32 倍——「字够不够大」完全由烘进图里的字号决定，界面上的任何缩放都帮不上忙。
 * 基准值（`DEFAULT_COMIC_STRIP_METRICS`）已按 0.32 倍反推到与微信正文同量级（约 17px），
 * 这三档是给作者按自己的读者和设备微调用的：`scale` 只作用于文字带（字号/行高/内边距），
 * 画布宽度与分镜图尺寸不动。
 */
export interface StoryboardTextScaleOption {
  id: string;
  label: string;
  /** 文字度量的缩放系数；1 = 基准档。 */
  scale: number;
  /** 界面上的一句话说明：手机上大概多少 px，好让作者不必靠猜。 */
  hint: string;
}

export const DEFAULT_STORYBOARD_TEXT_SCALE_ID = "standard";

/** 手机正文宽约 0.32 倍缩放下的实际观感：52 × 0.32 ≈ 17px（≈ 微信正文字号）。 */
export const STORYBOARD_TEXT_SCALE_OPTIONS: readonly StoryboardTextScaleOption[] = [
  { id: "compact", label: "紧凑", scale: 0.85, hint: "手机上约 14px，段更短" },
  { id: "standard", label: "标准", scale: 1, hint: "手机上约 17px，与微信正文同大" },
  { id: "large", label: "特大", scale: 1.2, hint: "手机上约 20px，最好读，段最长" }
];

/** 解析文字大小档位：空值/未知 id 一律回落标准档，拼接不因一个档位 id 卡住。 */
export function resolveStoryboardTextScale(
  textScaleId?: string | null
): StoryboardTextScaleOption {
  const normalized = textScaleId?.trim() ?? "";
  return (
    STORYBOARD_TEXT_SCALE_OPTIONS.find((option) => option.id === normalized) ??
    (STORYBOARD_TEXT_SCALE_OPTIONS[1] as StoryboardTextScaleOption)
  );
}

