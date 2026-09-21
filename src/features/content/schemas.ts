import { z } from "zod";
import {
  MAX_RECOMMENDED_WORDS,
  STORYBOARD_ROUTES
} from "@/features/articles/domain";
import type { ContentReviewResult } from "./ports";
import {
  STORY_COMIC_SEGMENT_TOLERANCE,
  storyComicSegmentTarget
} from "./story-comic-rules";
import {
  MAX_AVOID_ITEM_LENGTH,
  MAX_AVOID_ITEMS,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  STYLE_PRESET_IDS,
  type StyleProfile
} from "./style-profile";

/**
 * 预设清单从 `style-profile.ts` 派生：加新预设不必再来这里补一份。
 * 旧写法手抄一份 id 列表，漏登记就是「下拉里能选、提交时 400」。
 */
export const stylePresetSchema = z.enum(STYLE_PRESET_IDS);

export const audienceSchema = z.enum(["general_beginner", "office_desk", "senior_reader"]);

export const styleProfileSchema = z.object({
  preset: stylePresetSchema,
  audience: audienceSchema,
  persona: z.string().trim().min(1).max(200),
  tone: z.string().trim().min(1).max(200),
  readerAddress: z.string().trim().min(1).max(40),
  sentenceStyle: z.string().trim().min(1).max(300),
  explanationStyle: z.string().trim().min(1).max(300),
  humorLevel: z.enum(["none", "light", "moderate", "high"]),
  questionFrequency: z.enum(["low", "moderate", "high"]),
  contentDensity: z.enum(["low", "medium", "high"]),
  customInstructions: z.string().trim().max(MAX_CUSTOM_INSTRUCTIONS_LENGTH),
  avoid: z.array(z.string().trim().min(1).max(MAX_AVOID_ITEM_LENGTH)).max(MAX_AVOID_ITEMS)
}) satisfies z.ZodType<StyleProfile>;

/**
 * 分镜段的呈现路由；取值从 articles/domain 的 STORYBOARD_ROUTES 派生，别再手抄第二份
 * （2026-09-21 加 text_only 时就把三处手抄枚举收敛成了同一份）。
 */
export const storyboardRouteSchema = z.enum(STORYBOARD_ROUTES);

/**
 * 帧的台词/旁白。text 上限 30 是**结构闸**（放得进 JSON 就收）：
 * 精确的字数红线（对白 ≤10 / 旁白 ≤25，含容差）由 story-comic-rules 的红线闸报，
 * 那里的错误信息才带「该改成什么样」的指引。
 */
export const speechLineSchema = z.object({
  kind: z.enum(["dialogue", "narration"]),
  text: z.string().trim().min(1).max(30)
});

export const storyboardDesignFrameSchema = z.object({
  // 完整生图提示词：角色动作、场景道具、情绪氛围、镜头景别 + 画面文字。
  prompt: z.string().trim().min(1).max(2_000),
  altText: z.string().trim().min(1).max(120),
  speechLine: speechLineSchema.nullish()
});

export const storyboardDesignSegmentSchema = z.object({
  sectionKey: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(60),
  route: storyboardRouteSchema,
  copy: z.string().trim().min(1).max(2_000),
  /**
   * 帧数下限不设（0 帧是 text_only 纯文字段的合法形态）；每段帧数与路由的**精确对应**
   * 由 validateStoryboardDesign 的结构闸把关——那里的报错才带「该路由需要几帧」。
   */
  frames: z.array(storyboardDesignFrameSchema).max(2)
});

/**
 * segments 数组的结构上限。这是**结构闸**（放得进 JSON 就收），不是内容红线——
 * 段数够不够、每段有没有超 60 字，一律交给审核侧的红线闸说。
 *
 * 上限**由段数反推公式推出**，不写死：预算上限（`MAX_RECOMMENDED_WORDS`，深度档 2000）
 * ÷ 55 ≈ 36 段，加「允许上下浮动两段」再留两段余量就是 40。这样改长度档位区间
 * 会自动把闸门一起抬起来，不会出现「档位涨了、闸门没涨」的错位。
 *
 * 2026-09-20 真实模型验收就栽在这里：上限还停在讲解式时代的 16，而剧情漫画提示词
 * 按 1000 字要 18 段，模型老老实实照提示词产出却被 schema 判成
 * `Too big: expected array to have <=16 items`——看着像模型写错，其实是闸门没跟着公式走。
 * `schemas.test.ts` 有守卫测试盯着这条不变量。
 */
export const MAX_STORYBOARD_SEGMENTS =
  storyComicSegmentTarget(MAX_RECOMMENDED_WORDS) + STORY_COMIC_SEGMENT_TOLERANCE + 2;

export const storyboardDesignSchema = z.object({
  title: z.string().trim().min(1).max(120),
  segments: z.array(storyboardDesignSegmentSchema).min(1).max(MAX_STORYBOARD_SEGMENTS)
});

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
    input &&
      (scores ||
        "overallAssessment" in input ||
        "recommendation" in input ||
        // 后加的维度（hookStrength）老模型可能不返回：缺维也要走一遍净化补中性分，
        // 而不是让整份审核在校验层作废。
        !("hookStrength" in input))
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
    hookStrength: reviewScore(input.hookStrength ?? scores?.hookStrength),
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

/**
 * 一条审核结果最多能带多少条意见。上限同样跟着段数走：极端情况是「每段都被贴一条红线」，
 * 再给几条全篇问题留位置，所以是段数上限 + 8。旧值 24 是讲解式（段数上限 16）时代的数，
 * 段数抬上来后会把一份正常审核整份作废。服务端自己贴的机械红线不经过这里（净化后才追加），
 * 这条只拦模型乱喷。
 */
export const MAX_REVIEW_ISSUES = MAX_STORYBOARD_SEGMENTS + 8;

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
  hookStrength: z.number().int().min(1).max(5),
  outlineCoverage: z.number().int().min(1).max(5),
  sourceFidelity: z.number().int().min(1).max(5).nullable(),
  styleMatch: z.number().int().min(1).max(5),
  issues: z.array(contentReviewIssueSchema).max(MAX_REVIEW_ISSUES)
})) satisfies z.ZodType<ContentReviewResult>;
