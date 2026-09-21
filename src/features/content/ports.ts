import type {
  KnowledgeBrief,
  StoryboardPresentation,
  StoryboardRoute
} from "@/features/articles/domain";
import type { SpeechLine } from "@/features/images/domain";
import type { StyleProfile } from "./style-profile";

export const CONTENT_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "quote",
  "knowledge_card"
] as const;

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export interface GenerateContentOutlineSection {
  id: string;
  title: string;
  goal?: string;
  recommendedWords?: number;
  order: number;
}

/** 分镜设计器的输入：写作侧信息齐全，设计侧自带视觉约束。 */
export interface GenerateContentInput {
  topic: string;
  targetAudience: string;
  brief: KnowledgeBrief;
  outline: GenerateContentOutlineSection[];
  recommendedTotalWords: number;
  styleProfile: StyleProfile;
  sourceContext?: string;
  /**
   * 呈现形态：story_comic=剧情漫画（一段一个梗 + 群体拟人化演出），
   * illustrated=讲解式（知识写进图文卡，旧行为）。
   * 缺省按讲解式处理——调用点统一用 resolveStoryboardPresentation 解析后再传进来。
   */
  presentation?: StoryboardPresentation;
  /** 绘制风格；缺省时按提示词里的默认（黑白线条漫画）设计分镜。 */
  drawingStyle?: string;
  /** 参考形象摘要；缺省时不强制统一主角。 */
  character?: StoryboardCharacterBrief;
  model?: string;
}

/** 参考形象摘要：注入设计提示词，让所有分镜帧共用同一主角。 */
export interface StoryboardCharacterBrief {
  name: string;
  persona: string;
  description: string;
}

/** 一格分镜帧：prompt 就是引导生图模型的完整提示词。 */
export interface StoryboardDesignFrame {
  prompt: string;
  altText: string;
  /**
   * 帧的台词/旁白（剧情漫画形态，可选）：画面里不写字（D2/D3 红线），
   * 这句话由拼接渲染器烘成图外的橙条。省略 = 该格没有台词。
   */
  speechLine?: SpeechLine | null;
}

/** 一个分镜段：呈现路由 + 成稿文案 + 该路由所需数量的分镜帧。 */
export interface StoryboardDesignSegment {
  /** 对应的大纲章节 id（追溯覆盖关系）。 */
  sectionKey: string;
  /** 段落小标题，进段图标题卡。 */
  title: string;
  route: StoryboardRoute;
  /** 成稿文案：最终烘进段图里的文字。 */
  copy: string;
  frames: StoryboardDesignFrame[];
}

export interface StoryboardDesign {
  title: string;
  segments: StoryboardDesignSegment[];
}

/** 传给修订器的审核意见（与大纲修订同构：意见照传，由模型一次同时满足）。 */
export interface StoryboardReviewFeedback {
  status: ContentReviewStatus;
  summary: string;
  issues: ContentReviewIssue[];
}

/**
 * 分镜修订输入：当前全篇设计 + 修订意图（审核意见 / 作者要求）。
 * 修订器返回的仍是完整设计；被点名的段重写，未点名的段必须原样保留，
 * 编排层按内容 diff 决定哪些段真正落库替换。
 */
export interface ReviseStoryboardDesignInput {
  topic: string;
  targetAudience: string;
  brief: KnowledgeBrief;
  outline: GenerateContentOutlineSection[];
  recommendedTotalWords: number;
  styleProfile: StyleProfile;
  /** 当前分镜设计（由 planning.storyboardSegments + 正文块 + 帧资产还原）。 */
  currentDesign: StoryboardDesign;
  /** 审核点名的章节 id（由审核 issue 的 blockIds 映射而来）；空集 = 没有段被点名。 */
  flaggedSectionKeys: string[];
  reviewFeedback?: StoryboardReviewFeedback;
  /** 作者自然语言修改要求；优先级最高，给了它就不再要求先有审核记录。 */
  userInstructions?: string;
  /** 呈现形态：与初版同一口径，决定修订用哪套编排提示词与红线。 */
  presentation?: StoryboardPresentation;
  drawingStyle?: string;
  character?: StoryboardCharacterBrief;
  sourceContext?: string;
  model?: string;
}

/**
 * 第三步「设计正文分镜」的生成器：一次产出全篇的分镜设计
 * （逐段 route + 成稿文案 + 完整生图 prompt 的分镜帧）。
 */
export interface StoryboardDesigner {
  design(input: GenerateContentInput): Promise<StoryboardDesign>;
  /** 按审核意见 / 作者要求修订分镜：返回完整设计，未点名的段保持原样。 */
  revise(input: ReviseStoryboardDesignInput): Promise<StoryboardDesign>;
}

export type ContentReviewStatus = "passed" | "needs_revision" | "blocked";
export type ContentReviewSeverity = "warning" | "blocking";

export interface ContentReviewIssue {
  blockIds: string[];
  severity: ContentReviewSeverity;
  message: string;
}

export interface ContentReviewResult {
  status: ContentReviewStatus;
  summary: string;
  clarity: number;
  beginnerFriendliness: number;
  coherence: number;
  engagement: number;
  /** 钩子强度：前几句话抓不抓得住人（剧情漫画形态的主要考核项）。 */
  hookStrength: number;
  outlineCoverage: number;
  sourceFidelity: number | null;
  styleMatch: number;
  issues: ContentReviewIssue[];
}

export interface ReviewableContentBlock {
  id: string;
  type: string;
  content: string;
  order: number;
}

/**
 * 审核输入里的分镜帧：正文块里看不见的那部分内容。
 * 「画面里不许出现文字」「台词超长」这两条红线只存在于帧的 prompt / speechLine，
 * 只审 title+copy 是审不出来的。
 */
export interface ReviewableStoryboardFrame {
  prompt: string;
  speechLine?: SpeechLine | null;
}

/**
 * 审核输入里的分镜段：一段一行，锚定到该段的正文块 id（问题据此定位到块）。
 * 有它时剧情漫画红线按段核对（连同帧提示词与台词）；没有则退回按块流水线拼段。
 */
export interface ReviewableStoryboardSegment {
  /** 该段文案所在的正文块 id（标题块 + 文案块），用于把问题定位回界面。 */
  blockIds: string[];
  title: string;
  /**
   * 段的呈现路由（新快照才带）：纯文字段（text_only）不参与对白密度与段图类红线，
   * 全篇「纯文字占比 ≥30%」也按它数。老快照缺省时按非纯文字段处理。
   */
  route?: StoryboardRoute;
  copy: string;
  frames: ReviewableStoryboardFrame[];
}

export interface ReviewContentInput {
  topic: string;
  targetAudience?: string;
  styleProfile: StyleProfile;
  blocks: ReviewableContentBlock[];
  outline: GenerateContentOutlineSection[];
  sourceContext?: string;
  /**
   * 呈现形态：story_comic 时审核要按剧情漫画的红线判（每段 60 字、每句 26 字、
   * 台词长度、画面不许写字、总字数预算——具体阈值见 story-comic-rules），
   * 并由服务端补一遍机械检查；illustrated（默认）按原口径。
   */
  presentation?: StoryboardPresentation;
  /**
   * 分镜段（story_comic 的文章才有）：红线检查的完整素材来源。
   * 缺省时退回「按小标题分段的块流水线」——老快照与讲解式文章走这条路。
   */
  storyboardSegments?: ReviewableStoryboardSegment[];
  /** 全篇字数预算（快照里的 recommendedTotalWords），用于超预算警告；0/缺省表示不检查。 */
  recommendedTotalWords?: number;
  model?: string;
}

export interface ContentReviewer {
  review(input: ReviewContentInput): Promise<ContentReviewResult>;
}
