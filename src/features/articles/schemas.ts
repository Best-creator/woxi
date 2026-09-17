import { z } from "zod";
import { styleProfileSchema } from "@/features/content/schemas";

export const articleStatusSchema = z.enum([
  "draft",
  "brief_ready",
  "outline_ready",
  "editing",
  "content_ready",
  "ready_to_publish"
]);

export const contentBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "heading",
    "paragraph",
    "quote",
    "callout",
    "knowledge_card",
    "image"
  ]),
  content: z.string(),
  order: z.number().int().nonnegative(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  altText: z.string().optional(),
  assetId: z.string().min(1).optional(),
  // 正文分镜段标记：成稿文案块携带，用于分段拼接时找回所属段落。
  segmentId: z.string().min(1).optional(),
  version: z.number().int().positive()
});

/** 正文分镜段（planning.storyboardSegments 的条目）；原样透传，消费端用 isStoryboardRoute 校验。 */
export const storyboardSegmentSchema = z.object({
  id: z.string().min(1),
  sectionKey: z.string().min(1),
  title: z.string().min(1).max(120),
  route: z.enum(["image_text", "text_image", "image_text_image"]),
  copyBlockIds: z.array(z.string().min(1)),
  frameAssetIds: z.array(z.string().min(1)),
  order: z.number().int().nonnegative()
});

export const outlineSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500).optional(),
  recommendedWords: z.number().int().min(50).max(2000).optional(),
  order: z.number().int().nonnegative()
});

export const articlePlanningSchema = z.object({
  lengthPreset: z.enum(["short", "standard", "deep"]),
  recommendedTotalWords: z.number().int().min(800).max(2000).nullable(),
  confirmedOutlineRevisionId: z.string().min(1).nullable(),
  contentOutlineRevisionId: z.string().min(1).nullable(),
  // 漫画长图排法决策（视觉规划器写入）：原样透传，消费端用 isComicStripMode 校验。
  comicStripMode: z.string().nullable().optional(),
  comicStripReason: z.string().nullable().optional(),
  // 正文分镜设计（第三步写入）：原样透传，拼接阶段按段路由消费。
  storyboardSegments: z.array(storyboardSegmentSchema).nullable().optional(),
  // 分段拼接字体 id：原样透传，拼接时用 resolveStoryboardFont 解析（未知 id 回落默认字体）。
  storyboardFontId: z.string().trim().max(64).nullable().optional()
});

export const knowledgeBriefSchema = z.object({
  oneSentence: z.string(),
  concepts: z.array(z.string()),
  prerequisites: z.array(z.string()),
  misconceptions: z.array(z.string()),
  analogies: z.array(z.string()),
  unsupportedNotes: z.array(z.string())
});

export const createArticleSchema = z.object({
  topic: z.string().trim().min(1, "请输入要讲解的知识点").max(120),
  title: z.string().trim().max(120).optional()
});

export const updateArticleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  topic: z.string().trim().min(1).max(120),
  status: articleStatusSchema,
  brief: knowledgeBriefSchema.nullable(),
  outline: z.array(outlineSectionSchema),
  blocks: z.array(contentBlockSchema),
  planning: articlePlanningSchema,
  styleProfile: styleProfileSchema.optional(),
  outlineConfirmedAt: z.iso.datetime().nullable(),
  expectedUpdatedAt: z.iso.datetime()
});
