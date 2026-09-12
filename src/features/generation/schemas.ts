import { z } from "zod";
import type { GeneratedArticleContent } from "./content-generator";

const generatedContentBlockSchema = z.strictObject({
  id: z.string().trim().min(1).max(128),
  type: z.enum(["heading", "paragraph", "callout"]),
  content: z.string().trim().min(1).max(20_000),
  order: z.number().int().nonnegative(),
  version: z.literal(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});

export const generatedArticleContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  blocks: z.array(generatedContentBlockSchema).min(1).max(200)
}) satisfies z.ZodType<GeneratedArticleContent>;
