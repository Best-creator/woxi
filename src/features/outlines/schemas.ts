import { knowledgeBriefSchema } from "@/features/articles/schemas";
import {
  MAX_RECOMMENDED_WORDS,
  MIN_RECOMMENDED_WORDS
} from "@/features/articles/domain";
import { z } from "zod";
import type { GeneratedOutline, OutlineReviewResult } from "./domain";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeGeneratedOutline(value: unknown) {
  const input = record(value);
  const inputBrief = record(input?.brief);
  const sections = Array.isArray(input?.sections)
    ? input.sections.map(record).filter((section): section is Record<string, unknown> => section !== null)
    : Array.isArray(input?.outline)
      ? input.outline.map(record).filter((section): section is Record<string, unknown> => section !== null)
      : [];
  const hasGeminiBriefFields = Boolean(
    inputBrief && ("coreMessage" in inputBrief || "commonMisconceptions" in inputBrief || "recommendedWordCount" in inputBrief)
  );
  if (!input || !inputBrief || !sections.length || (!Array.isArray(input?.sections) && !hasGeminiBriefFields)) return value;

  const normalizedSections = sections.map((section, index) => {
    const keyPoints = stringArray(section.keyPoints);
    const hook = typeof section.intuitiveHook === "string" ? section.intuitiveHook.trim() : "";
    const title = typeof section.title === "string" ? section.title : `第${index + 1}部分`;
    const recommendedWords = typeof section.intendedWordCount === "number"
      ? section.intendedWordCount
      : typeof section.recommendedWords === "number" ? section.recommendedWords : 50;
    return {
      key: typeof section.key === "string" ? section.key : `section-${String(section.sectionNumber ?? index + 1)}`,
      title,
      goal: (typeof section.goal === "string" ? section.goal : hook || keyPoints[0] || title).slice(0, 500),
      recommendedWords
    };
  });
  const sectionWords = normalizedSections.reduce((total, section) => total + section.recommendedWords, 0);
  const topic = typeof inputBrief.topic === "string" ? inputBrief.topic : "知识点";
  // 剧情推演：接受 storyline/storyLine/narrativeLine/plotOutline 字段名变体；
  // 模型没给时用各章 goal 拼接兜底——拼接版不如真正的推演，但至少让章节钩子链进入下游，
  // 比整条链路硬失败更可用。质量由大纲审核（storyline 判据）兜底。
  const rawStoryline = [
    input.storyline,
    input.storyLine,
    input.narrativeLine,
    input.plotOutline
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  const storyline = typeof rawStoryline === "string"
    ? rawStoryline.trim()
    : normalizedSections.map((section) => section.goal).join(" ");
  const explicitConcepts = stringArray(inputBrief.concepts);
  const concepts = explicitConcepts.length
    ? explicitConcepts
    : Array.from(new Set(sections.flatMap((section) => stringArray(section.terminologyToIntroduce))));

  return {
    workingTitle: typeof input.workingTitle === "string" ? input.workingTitle : topic,
    recommendedTotalWords: typeof input.recommendedTotalWords === "number" ? input.recommendedTotalWords : sectionWords,
    brief: {
      oneSentence: typeof inputBrief.oneSentence === "string"
        ? inputBrief.oneSentence
        : typeof inputBrief.coreMessage === "string" ? inputBrief.coreMessage : topic,
      concepts: concepts.length ? concepts : [topic],
      prerequisites: stringArray(inputBrief.prerequisites),
      misconceptions: stringArray(inputBrief.misconceptions ?? inputBrief.commonMisconceptions),
      analogies: stringArray(inputBrief.analogies).concat(
        sections.map((section) => typeof section.intuitiveHook === "string" ? section.intuitiveHook : "").filter(Boolean)
      ),
      unsupportedNotes: stringArray(inputBrief.unsupportedNotes)
    },
    outline: normalizedSections,
    storyline
  };
}

function reviewScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 3;
}

function normalizeReviewStatus(value: unknown) {
  if (value === "passed" || value === "pass" || value === "approved") return "passed";
  if (value === "blocked" || value === "block" || value === "failed") return "blocked";
  return "needs_revision";
}

function normalizeOutlineReview(value: unknown) {
  const input = record(value);
  const scores = record(input?.scores);
  const hasAlternateFields = Boolean(
    input && (scores || "overallAssessment" in input || "overallSummary" in input || "recommendation" in input)
  );
  if (!input || !hasAlternateFields) return value;

  const rawIssues = Array.isArray(input.issues) ? input.issues : [];
  return {
    status: normalizeReviewStatus(input.status ?? input.recommendation ?? input.overallStatus),
    summary: typeof input.summary === "string"
      ? input.summary
      : typeof input.overallAssessment === "string"
        ? input.overallAssessment
        : typeof input.overallSummary === "string" ? input.overallSummary : "审核完成。",
    coverage: reviewScore(input.coverage ?? scores?.coverage),
    granularity: reviewScore(input.granularity ?? scores?.granularity),
    beginnerFriendliness: reviewScore(input.beginnerFriendliness ?? scores?.beginnerFriendliness ?? scores?.beginnerFriendlinessScore),
    logicalOrder: reviewScore(input.logicalOrder ?? scores?.logicalOrder),
    sourceSupport: input.sourceSupport === null || scores?.sourceSupport === null
      ? null
      : reviewScore(input.sourceSupport ?? scores?.sourceSupport),
    hiddenPrerequisites: stringArray(input.hiddenPrerequisites ?? input.missingPrerequisites),
    complexDependencies: stringArray(input.complexDependencies ?? input.complexConcepts),
    issues: rawIssues.map((rawIssue) => {
      const issue = record(rawIssue) ?? {};
      const sectionNumber = issue.sectionNumber ?? issue.section;
      return {
        sectionKey: typeof issue.sectionKey === "string"
          ? issue.sectionKey
          : typeof issue.sectionId === "string"
            ? issue.sectionId
            : `section-${String(sectionNumber ?? "unknown")}`,
        severity: issue.severity === "blocking" || issue.severity === "critical" || issue.severity === "error" ? "blocking" : "warning",
        message: typeof issue.message === "string"
          ? issue.message
          : typeof issue.description === "string" ? issue.description : "需要补充说明。"
      };
    })
  };
}

const generatedOutlineSectionSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_-]+$/).max(64),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  recommendedWords: z.number().int().min(50).max(2000)
});

export const generatedOutlineSchema = z.preprocess(normalizeGeneratedOutline, z.strictObject({
  workingTitle: z.string().trim().min(1).max(120),
  recommendedTotalWords: z
    .number()
    .int()
    .min(MIN_RECOMMENDED_WORDS)
    .max(MAX_RECOMMENDED_WORDS),
  brief: knowledgeBriefSchema.strict(),
  outline: z.array(generatedOutlineSectionSchema).min(2).max(12),
  // 全篇剧情推演：下限只拦空串——体量门槛（≥60 字）由 OpenAiOutlineGenerator.validateGeneratedOutline
  // 把守（那里能带上「重新生成」的重试语义）；这里宽一点，兼容 goal 拼接的兜底路径。
  storyline: z.string().trim().min(1).max(1200)
})) satisfies z.ZodType<GeneratedOutline>;

const outlineReviewIssueSchema = z.strictObject({
  sectionKey: z.string().trim().min(1).max(64),
  severity: z.enum(["warning", "blocking"]),
  message: z.string().trim().min(1).max(500)
});

export const outlineReviewResultSchema = z.preprocess(normalizeOutlineReview, z.strictObject({
  status: z.enum(["passed", "needs_revision", "blocked"]),
  summary: z.string().trim().min(1).max(1000),
  coverage: z.number().int().min(1).max(5),
  granularity: z.number().int().min(1).max(5),
  beginnerFriendliness: z.number().int().min(1).max(5),
  logicalOrder: z.number().int().min(1).max(5),
  sourceSupport: z.number().int().min(1).max(5).nullable(),
  hiddenPrerequisites: z.array(z.string().trim().min(1).max(300)).max(12),
  complexDependencies: z.array(z.string().trim().min(1).max(300)).max(12),
  issues: z.array(outlineReviewIssueSchema).max(24)
})) satisfies z.ZodType<OutlineReviewResult>;
