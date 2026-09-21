// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveStyleProfile } from "./style-profile";
import { sanitizeContentReview } from "./openai-content-reviewer";
import type { ContentReviewResult, ReviewContentInput } from "./ports";
import { STORY_COMIC_MAX_SENTENCE_CHARS } from "./story-comic-rules";

function reviewInput(overrides: Partial<ReviewContentInput> = {}): ReviewContentInput {
  return {
    topic: "机会成本",
    styleProfile: resolveStyleProfile("popular_science_teacher"),
    blocks: [
      { id: "block-1", type: "paragraph", content: "第一段", order: 0 },
      { id: "block-2", type: "paragraph", content: "第二段", order: 1 }
    ],
    outline: [],
    ...overrides
  };
}

function reviewResult(overrides: Partial<ContentReviewResult> = {}): ContentReviewResult {
  return {
    status: "needs_revision",
    summary: "整体可读",
    clarity: 4,
    beginnerFriendliness: 4,
    coherence: 4,
    engagement: 4,
    hookStrength: 4,
    outlineCoverage: 4,
    sourceFidelity: null,
    styleMatch: 4,
    issues: [],
    ...overrides
  };
}

describe("sanitizeContentReview", () => {
  it("drops hallucinated block ids but keeps the issue itself", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        issues: [
          { blockIds: ["block-2", "block-hallucinated"], severity: "warning", message: "第二段单薄" },
          { blockIds: ["ghost-1"], severity: "warning", message: "结尾仓促" }
        ]
      }),
      reviewInput()
    );

    expect(sanitized.issues[0]!.blockIds).toEqual(["block-2"]);
    // 全部 id 都虚构的意见退化为「不可定位」：意见保留，UI 的定位按钮自然禁用。
    expect(sanitized.issues[1]!.blockIds).toEqual([]);
  });

  it("keeps valid ids and a passing review untouched", () => {
    const result = reviewResult({
      status: "passed",
      issues: [{ blockIds: ["block-1"], severity: "warning", message: "小瑕疵" }]
    });

    expect(sanitizeContentReview(result, reviewInput())).toEqual(result);
  });

  it("coerces sourceFidelity to null without sources, and to a neutral score when the model omits it", () => {
    const withoutSource = sanitizeContentReview(
      reviewResult({ sourceFidelity: 5 }),
      reviewInput()
    );
    expect(withoutSource.sourceFidelity).toBeNull();

    const withSource = sanitizeContentReview(
      reviewResult({ sourceFidelity: null }),
      reviewInput({ sourceContext: "【资料】袋熊的肠道构造……" })
    );
    expect(withSource.sourceFidelity).toBe(3);
  });

  it("downgrades a blocked review that lacks a blocking issue", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        status: "blocked",
        issues: [{ blockIds: [], severity: "warning", message: "表达不稳" }]
      }),
      reviewInput()
    );

    expect(sanitized.status).toBe("needs_revision");
  });

  it("keeps blocked when a blocking issue supports it", () => {
    const sanitized = sanitizeContentReview(
      reviewResult({
        status: "blocked",
        issues: [{ blockIds: ["block-1"], severity: "blocking", message: "事实错误" }]
      }),
      reviewInput()
    );

    expect(sanitized.status).toBe("blocked");
  });
});

describe("sanitizeContentReview 的剧情漫画红线", () => {
  /** 剧情漫画的审核输入：每段 = 小标题块 + 文案块（与生成落库的形态一致）。 */
  function storyComicInput(overrides: Partial<ReviewContentInput> = {}): ReviewContentInput {
    return reviewInput({
      presentation: "story_comic",
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "一群小家伙围上来。", order: 1 },
        { id: "seg2-h", type: "heading", content: "机制", order: 2 },
        { id: "seg2-p", type: "paragraph", content: "带头的先跳上去。", order: 3 }
      ],
      ...overrides
    });
  }

  it("adds nothing when the copy keeps the red lines", () => {
    const result = reviewResult({ status: "passed" });
    expect(sanitizeContentReview(result, storyComicInput()).issues).toEqual([]);
  });

  it("flags an over-long segment against its own heading block", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "字".repeat(80), order: 1 }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);

    // 同一段既超段长又超句长：两条都贴出来，都定位到该段的小标题块。
    expect(sanitized.issues).toHaveLength(2);
    expect(sanitized.issues[0]).toMatchObject({ blockIds: ["seg1-h"], severity: "warning" });
    expect(sanitized.issues[0]!.message).toContain("「开场」段");
    expect(sanitized.issues[0]!.message).toContain("超过剧情漫画每段 60 字");
    expect(sanitized.issues[1]!.message).toContain("长句");
    // 模型说「通过」但机械红线越界：降级为需要修订——生成阶段不再拦这些红线，
    // 审核是唯一的把关点，不能一边报问题一边说通过。
    expect(sanitized.status).toBe("needs_revision");
  });

  it("flags long sentences, explanatory connectives and long enumerations", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "首先说清背景；其次再讲代价。", order: 1 },
        { id: "seg1-p2", type: "paragraph", content: "苹果、香蕉、橘子、梨、葡萄都摆着。", order: 2 },
        { id: "seg1-p3", type: "paragraph", content: "这句话故意写得特别长，长到远远超过我们给单个句子定下的那条字数限制，还得再多写一截才够。", order: 3 }
      ]
    });

    const messages = sanitizeContentReview(reviewResult({ status: "passed" }), input).issues.map(
      (issue) => issue.message
    );

    expect(messages.some((message) => message.includes("长句"))).toBe(true);
    expect(messages.some((message) => message.includes("分点推进"))).toBe(true);
    expect(messages.some((message) => message.includes("并列列举"))).toBe(true);
  });

  it("does not mistake a plain spoken 「最后」 for a textbook connective", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "最后还是最小的那只先找对了门道。", order: 1 }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });

  it("downgrades a passing review as soon as a red line is broken（审核接管把关）", () => {
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        {
          id: "seg1-p",
          type: "paragraph",
          content: "鲜笋被塞进无氧陶坛，厌氧菌在锅里疯狂干饭，硬生生把整坛鲜味熬成了一枚威力惊人的生化炸弹",
          order: 1
        }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);

    expect(sanitized.status).toBe("needs_revision");
    expect(sanitized.issues[0]!.message).toContain(
      `每句话不超过 ${STORY_COMIC_MAX_SENTENCE_CHARS} 字`
    );
  });

  it("checks frame prompts and speech lines when the input carries the storyboard", () => {
    const input = storyComicInput({
      storyboardSegments: [
        {
          blockIds: ["seg1-h", "seg1-p"],
          title: "开场",
          copy: "一群小家伙围上来。",
          frames: [
            { prompt: "全景。三只柴犬。画面文字：对白气泡『上啊』" },
            {
              prompt: "近景。同一场景的下一秒。纯白背景。",
              speechLine: { kind: "narration", text: "字".repeat(40) }
            }
          ]
        }
      ]
    });

    const messages = sanitizeContentReview(reviewResult({ status: "passed" }), input).issues.map(
      (issue) => issue.message
    );

    // 画面写字与台词超长只存在于帧里，按块流水线审不出来——带分镜输入才判得全。
    expect(messages.some((message) => message.includes("不得出现任何文字"))).toBe(true);
    expect(messages.some((message) => message.includes("旁白"))).toBe(true);
  });

  it("warns about the whole-article total when the copy outgrows the budget", () => {
    const input = storyComicInput({
      recommendedTotalWords: 15,
      storyboardSegments: [
        { blockIds: ["seg1-h", "seg1-p"], title: "开场", copy: "一二三四五六七八九十。", frames: [] },
        { blockIds: ["seg2-h", "seg2-p"], title: "机制", copy: "一二三四五六七八九十。", frames: [] }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);
    const budgetIssue = sanitized.issues.find((issue) => issue.message.includes("预算"));

    expect(budgetIssue).toBeDefined();
    // 全篇问题不算在某一段头上：blockIds 为空，界面显示为「不可定位」。
    expect(budgetIssue!.blockIds).toEqual([]);
    expect(sanitized.status).toBe("needs_revision");
  });

  it("counts only the copy against the whole-article budget (段名不进正文)", () => {
    // 两段各 11 字文案 + 3 字段名 = 老口径 28 字，会冒出一条预算警告；
    // 新口径只数读者读到的 22 字文案，预算内就没有问题——段名不进正文，自然也不占预算。
    const input = storyComicInput({
      recommendedTotalWords: 20,
      storyboardSegments: [
        { blockIds: ["seg1-h", "seg1-p"], title: "开场白", copy: "一二三四五六七八九十。", frames: [] },
        { blockIds: ["seg2-h", "seg2-p"], title: "机制说", copy: "一二三四五六七八九十。", frames: [] }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);

    expect(sanitized.issues.some((issue) => issue.message.includes("预算"))).toBe(false);
  });

  it("counts only the copy against the per-segment cap (段名再长也不占 60 字)", () => {
    const input = storyComicInput({
      storyboardSegments: [
        {
          blockIds: ["seg1-h", "seg1-p"],
          title: "开场：一群小家伙排队进场的完整段名",
          copy: "字".repeat(60),
          frames: []
        }
      ]
    });

    const messages = sanitizeContentReview(reviewResult({ status: "passed" }), input).issues.map(
      (issue) => issue.message
    );

    // 文案正好 60 字：卡在上限内，不该因为段名有 17 字就被判越界。
    expect(messages.some((message) => message.includes("超过剧情漫画每段"))).toBe(false);
  });

  it("flags a dialogue deficit as a whole-article issue（全篇对白密度）", () => {
    // 带分镜的输入才判对白密度：2 段至少要 2 个对白帧，一个都没有就是旁白独角戏。
    const input = storyComicInput({
      storyboardSegments: [
        {
          blockIds: ["seg1-h", "seg1-p"],
          title: "开场",
          copy: "一群小家伙围上来。",
          frames: [{ prompt: "全景。三只柴犬围上来。纯白背景。" }]
        },
        {
          blockIds: ["seg2-h", "seg2-p"],
          title: "机制",
          copy: "带头的先跳上去。",
          frames: [
            {
              prompt: "近景。带头的跳上去。纯白背景。",
              speechLine: { kind: "narration", text: "看热闹的先看见门道。" }
            }
          ]
        }
      ]
    });

    const sanitized = sanitizeContentReview(reviewResult({ status: "passed" }), input);
    const dialogueIssue = sanitized.issues.find((issue) => issue.message.includes("对白帧"));

    expect(dialogueIssue).toBeDefined();
    expect(dialogueIssue!.blockIds).toEqual([]);
    expect(dialogueIssue!.message).toContain("一来一往");
    expect(sanitized.status).toBe("needs_revision");
  });

  it("stays quiet when the dialogue quota is met", () => {
    const input = storyComicInput({
      storyboardSegments: [
        {
          blockIds: ["seg1-h", "seg1-p"],
          title: "开场",
          copy: "一群小家伙围上来。",
          frames: [
            {
              prompt: "全景。三只柴犬围上来。纯白背景。画面文字：对白气泡『让让呗』",
              speechLine: { kind: "dialogue", text: "让让呗" }
            }
          ]
        },
        {
          blockIds: ["seg2-h", "seg2-p"],
          title: "机制",
          copy: "带头的先跳上去。",
          frames: [
            {
              prompt: "近景。带头的跳上去，旁边那只捂嘴看它。纯白背景。画面文字：对白气泡『你行你上』",
              speechLine: { kind: "dialogue", text: "你行你上" }
            }
          ]
        }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });

  it("skips the dialogue quota for legacy snapshots without frames（老快照不误伤）", () => {
    // 老快照走「小标题块 + 文案块」的退化路径，帧信息全空——判不了也不该判对白密度，
    // 否则每一篇老文章都会凭空多出一条「对白不足」。
    const input = storyComicInput({
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "一群小家伙围上来。", order: 1 },
        { id: "seg2-h", type: "heading", content: "机制", order: 2 },
        { id: "seg2-p", type: "paragraph", content: "带头的先跳上去。", order: 3 }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });

  it("leaves the illustrated form alone", () => {
    const input = storyComicInput({
      presentation: "illustrated",
      blocks: [
        { id: "seg1-h", type: "heading", content: "开场", order: 0 },
        { id: "seg1-p", type: "paragraph", content: "字".repeat(80), order: 1 }
      ]
    });

    expect(sanitizeContentReview(reviewResult({ status: "passed" }), input).issues).toEqual([]);
  });
});
