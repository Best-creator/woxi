import { z } from "zod";

const sharedSuggestionFields = {
  purpose: z.string().trim().min(1).max(500),
  prompt: z.string().trim().min(1).max(4000),
  altText: z.string().trim().min(1).max(240),
  aspectRatio: z.enum(["cover", "landscape", "square", "portrait"])
};

export const imagePlanSuggestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...sharedSuggestionFields,
    type: z.literal("cover"),
    anchorBlockId: z.null()
  }),
  // 动漫分镜：解释正文中需要图示的点；景别与序号由规划器归一化进 purpose/prompt。
  z.object({
    ...sharedSuggestionFields,
    type: z.literal("storyboard"),
    anchorBlockId: z.string().min(1),
    sceneNumber: z.number().int().min(1).max(99),
    shot: z.string().trim().min(1).max(20)
  }),
  z.object({
    ...sharedSuggestionFields,
    type: z.enum(["concept", "process", "comparison", "knowledge_card"]),
    anchorBlockId: z.string().min(1)
  })
]);

export const imagePlanResponseSchema = z.object({
  images: z.array(imagePlanSuggestionSchema).max(12)
});
