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
  version: z.number().int().positive()
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
  contentOutlineRevisionId: z.string().min(1).nullable()
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
