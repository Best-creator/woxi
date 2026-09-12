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
  z.object({
    ...sharedSuggestionFields,
    type: z.enum(["concept", "process", "comparison", "knowledge_card"]),
    anchorBlockId: z.string().min(1)
  })
]);

export const imagePlanResponseSchema = z.object({
  images: z.array(imagePlanSuggestionSchema).max(12)
});
