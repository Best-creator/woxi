import { z } from "zod";
import type { ContentReviewResult, GeneratedContent } from "./ports";
import {
  MAX_AVOID_ITEM_LENGTH,
  MAX_AVOID_ITEMS,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  type StyleProfile
} from "./style-profile";

export const stylePresetSchema = z.enum([
  "popular_science_teacher",
  "plain_explainer",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "knowledge_cards",
  "custom"
]);

export const audienceSchema = z.enum(["general_beginner", "office_desk", "senior_reader"]);

export const styleProfileSchema = z.object({
  preset: stylePresetSchema,
  audience: audienceSchema,
  persona: z.string().trim().min(1).max(200),
  tone: z.string().trim().min(1).max(200),
  readerAddress: z.string().trim().min(1).max(40),
  sentenceStyle: z.string().trim().min(1).max(300),
  explanationStyle: z.string().trim().min(1).max(300),
  humorLevel: z.enum(["none", "light", "moderate"]),
  questionFrequency: z.enum(["low", "moderate", "high"]),
  contentDensity: z.enum(["low", "medium", "high"]),
  customInstructions: z.string().trim().max(MAX_CUSTOM_INSTRUCTIONS_LENGTH),
  avoid: z.array(z.string().trim().min(1).max(MAX_AVOID_ITEM_LENGTH)).max(MAX_AVOID_ITEMS)
}) satisfies z.ZodType<StyleProfile>;

export const generatedContentBlockSchema = z.object({
  sectionKey: z.string().trim().min(1).max(64),
  type: z.enum(["heading", "paragraph", "quote", "callout", "knowledge_card"]),
  content: z.string().trim().min(1).max(5_000),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});

export const generatedContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  blocks: z.array(generatedContentBlockSchema).min(4).max(80)
}) satisfies z.ZodType<GeneratedContent>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeReviewStatus(value: unknown) {
  if (value === "passed" || value === "pass" || value === "approved") return "passed";
  if (value === "blocked" || value === "block" || value === "failed") return "blocked";
  return "needs_revision";
}

function reviewScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 3;
}

function blockIdList(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 24);
}

function normalizeContentReview(value: unknown) {
  const input = record(value);
  const scores = record(input?.scores);
  const hasAlternateFields = Boolean(
    input && (scores || "overallAssessment" in input || "recommendation" in input)
  );
  if (!input || !hasAlternateFields) return value;

  const rawIssues = Array.isArray(input.issues) ? input.issues : [];
  return {
    status: normalizeReviewStatus(input.status ?? input.recommendation),
    summary: typeof input.summary === "string"
      ? input.summary
      : typeof input.overallAssessment === "string"
        ? input.overallAssessment
        : "审核完成。",
    clarity: reviewScore(input.clarity ?? scores?.clarity),
    beginnerFriendliness: reviewScore(input.beginnerFriendliness ?? scores?.beginnerFriendliness),
    coherence: reviewScore(input.coherence ?? scores?.coherence),
    engagement: reviewScore(input.engagement ?? scores?.engagement),
    outlineCoverage: reviewScore(input.outlineCoverage ?? scores?.outlineCoverage),
    sourceFidelity: input.sourceFidelity === null || scores?.sourceFidelity === null
      ? null
      : reviewScore(input.sourceFidelity ?? scores?.sourceFidelity),
    styleMatch: reviewScore(input.styleMatch ?? scores?.styleMatch),
    issues: rawIssues.map((rawIssue) => {
      const issue = record(rawIssue) ?? {};
      return {
        blockIds: blockIdList(issue.blockIds ?? issue.blockId ?? issue.blocks),
        severity: issue.severity === "blocking" || issue.severity === "critical" ? "blocking" : "warning",
        message: typeof issue.message === "string"
          ? issue.message
          : typeof issue.description === "string" ? issue.description : "需要人工检查。"
      };
    })
  };
}

const contentReviewIssueSchema = z.object({
  blockIds: z.array(z.string().trim().min(1).max(128)).max(24),
  severity: z.enum(["warning", "blocking"]),
  message: z.string().trim().min(1).max(500)
});

export const contentReviewResultSchema = z.preprocess(normalizeContentReview, z.object({
  status: z.enum(["passed", "needs_revision", "blocked"]),
  summary: z.string().trim().min(1).max(1_000),
  clarity: z.number().int().min(1).max(5),
  beginnerFriendliness: z.number().int().min(1).max(5),
  coherence: z.number().int().min(1).max(5),
  engagement: z.number().int().min(1).max(5),
  outlineCoverage: z.number().int().min(1).max(5),
  sourceFidelity: z.number().int().min(1).max(5).nullable(),
  styleMatch: z.number().int().min(1).max(5),
  issues: z.array(contentReviewIssueSchema).max(24)
})) satisfies z.ZodType<ContentReviewResult>;
