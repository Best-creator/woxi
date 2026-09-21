// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBrief, OutlineSection } from "@/features/articles/domain";
import { resolveStyleProfile } from "./style-profile";
import {
  OpenAiStoryboardDesigner,
  STORYBOARD_DESIGNER_STORY_COMIC_PROMPT,
  STORYBOARD_DESIGNER_SYSTEM_PROMPT,
  STORYBOARD_REVISER_STORY_COMIC_PROMPT,
  STORYBOARD_REVISER_SYSTEM_PROMPT,
  validateStoryboardDesign
} from "./openai-storyboard-designer";
import type { GenerateContentInput, ReviseStoryboardDesignInput, StoryboardDesign } from "./ports";
import { MAX_STORYBOARD_SEGMENTS } from "./schemas";
import {
  STORY_COMIC_MAX_DIALOGUE_CHARS,
  STORY_COMIC_MAX_NARRATION_CHARS,
  STORY_COMIC_MAX_SEGMENT_CHARS,
  STORY_COMIC_MAX_SENTENCE_CHARS,
  STORY_COMIC_MIN_DIALOGUE_FRAMES,
  STORY_COMIC_SEGMENTS_PER_DIALOGUE,
  STORY_COMIC_WORDS_PER_SEGMENT
} from "./story-comic-rules";

function demoBrief(): KnowledgeBrief {
  return {
    oneSentence: "放弃的最佳替代方案就是机会成本",
    concepts: ["机会成本"],
    prerequisites: ["选择"],
    misconceptions: ["机会成本只算钱"],
    analogies: ["双色球选择题"],
    unsupportedNotes: []
  };
}

function demoOutline(): OutlineSection[] {
  return [
    { id: "section-1", title: "什么是机会成本", order: 0, recommendedWords: 300 },
    { id: "section-2", title: "怎么权衡", order: 1, recommendedWords: 300 }
  ];
}

const baseInput: GenerateContentInput = {
  topic: "什么是机会成本",
  targetAudience: "零基础读者",
  brief: demoBrief(),
  outline: demoOutline(),
  recommendedTotalWords: 600,
  styleProfile: resolveStyleProfile("popular_science_teacher")
};

function validDesign(): StoryboardDesign {
  return {
    title: "读标题就知道讲什么",
    segments: [
      {
        sectionKey: "section-1",
        title: "什么是机会成本",
        route: "image_text",
        copy: "放弃掉的那个选项，就是你为选择付出的真实代价。",
        frames: [{ prompt: "全景。主角讲解。画面文字：对白气泡『机会成本』", altText: "机会成本讲解" }]
      },
      {
        sectionKey: "section-2",
        title: "怎么权衡",
        route: "image_text_image",
        copy: "把两个选项摆在一起，比一比各自放弃什么。",
        frames: [
          { prompt: "中景。第一帧。画面文字：旁白框『先比一比』", altText: "权衡第一步" },
          { prompt: "近景。第二帧。画面文字：旁白框『再选一个』", altText: "权衡第二步" }
        ]
      }
    ]
  };
}

describe("validateStoryboardDesign", () => {
  it("accepts a design that covers every section with matching frame counts", () => {
    const design = validDesign();
    expect(validateStoryboardDesign(design, baseInput)).toBe(design);
  });

  it("rejects unknown section keys", () => {
    const design = validDesign();
    design.segments[0]!.sectionKey = "section-missing";
    expect(() => validateStoryboardDesign(design, baseInput)).toThrow("未知章节");
  });

  it("rejects designs that miss an outline section", () => {
    const design = validDesign();
    design.segments = design.segments.slice(0, 1);
    expect(() => validateStoryboardDesign(design, baseInput)).toThrow("遗漏了章节");
  });

  it("rejects route and frame count mismatches", () => {
    const design = validDesign();
    design.segments[1]!.frames = design.segments[1]!.frames.slice(0, 1);
    expect(() => validateStoryboardDesign(design, baseInput)).toThrow("需要 2 帧分镜");
  });

  it("no longer rejects copy that blows past the word budget（越界改由审核把关）", () => {
    const design = validDesign();
    for (const segment of design.segments) {
      segment.copy = "长".repeat(700);
    }
    expect(validateStoryboardDesign(design, baseInput)).toBe(design);
  });
});

/** 剧情漫画形态的合规样例：一段一个梗、旁白式短句、画面里不写字。 */
function storyComicDesign(): StoryboardDesign {
  return {
    title: "三只柴犬推箱子",
    segments: [
      {
        sectionKey: "section-1",
        title: "什么是机会成本",
        route: "image_text",
        copy: "一群小家伙围上来。\n\n谁都不肯先动手。",
        frames: [{ prompt: "全景。三只柴犬围着食盆探头探脑。纯白背景。", altText: "三只柴犬围观" }]
      },
      {
        sectionKey: "section-2",
        title: "怎么权衡",
        route: "image_text_image",
        copy: "带头的先跳上去。\n\n它滑倒了。",
        frames: [
          { prompt: "中景。三只柴犬一起推着大箱子。纯白背景。", altText: "一起推箱子" },
          { prompt: "近景。同一场景的下一秒，箱子翻了。纯白背景。", altText: "箱子翻了" }
        ]
      }
    ]
  };
}

describe("validateStoryboardDesign 的剧情漫画红线（生成阶段不再打回）", () => {
  const storyComicInput: GenerateContentInput = { ...baseInput, presentation: "story_comic" };

  it("accepts a compliant story comic design", () => {
    const design = storyComicDesign();
    expect(validateStoryboardDesign(design, storyComicInput)).toBe(design);
  });

  it("lets a 29-character sentence through so the design can be saved as a version", () => {
    // 作者原话：「你得先有东西出来」——生成阶段必须先产出可版本化的设计稿，
    // 「每句不超过 26 字」这类限制由审核环节标出来，不在生成阶段打回。
    const design = storyComicDesign();
    design.segments[0]!.copy = "鲜笋被塞进无氧陶坛，厌氧菌疯狂干饭，硬把整坛鲜味熬成生化弹";
    const result = validateStoryboardDesign(design, storyComicInput);
    expect(result).toBe(design);
    expect(result.segments[0]!.copy.length).toBe(29);
  });

  it("lets an oversized segment, an over-long line and a draw-text prompt through", () => {
    const design = storyComicDesign();
    design.segments[0]!.copy = "字".repeat(70);
    design.segments[1]!.frames[0]!.prompt = "全景。三只柴犬。画面文字：对白气泡『上啊』";
    design.segments[1]!.frames[0]!.speechLine = { kind: "narration", text: "字".repeat(40) };
    expect(validateStoryboardDesign(design, storyComicInput)).toBe(design);
  });

  it("still rejects route and frame count mismatches（结构性错误照样打回）", () => {
    const design = storyComicDesign();
    design.segments[1]!.frames = design.segments[1]!.frames.slice(0, 1);
    expect(() => validateStoryboardDesign(design, storyComicInput)).toThrow("需要 2 帧分镜");
  });

  it("leaves the illustrated form on its own rules", () => {
    // 同一份「违规」设计在讲解式下不做剧情漫画的红线检查（旧文产物一个字不变）。
    const design = storyComicDesign();
    design.segments[0]!.copy = "字".repeat(70);
    design.segments[0]!.frames[0]!.prompt = "全景。三只柴犬。画面文字：对白气泡『上啊』";
    expect(() => validateStoryboardDesign(design, baseInput)).not.toThrow();
  });
});

describe("OpenAiStoryboardDesigner", () => {
  it("sends style, character and outline to the JSON client and validates the payload", async () => {
    const complete = vi.fn(async (request: { schema: { parse: (value: unknown) => unknown }; userPayload: Record<string, unknown> }) => {
      // 模拟真实链路：返回值必须先过 schema。
      const raw = {
        title: "设计稿标题",
        segments: [
          {
            sectionKey: "section-1",
            title: "段一",
            route: "text_image",
            copy: "文案",
            frames: [{ prompt: "prompt", altText: "alt" }]
          },
          {
            sectionKey: "section-2",
            title: "段二",
            route: "image_text",
            copy: "文案",
            frames: [{ prompt: "prompt", altText: "alt" }]
          }
        ]
      };
      request.schema.parse(raw);
      return raw as never;
    });
    const designer = new OpenAiStoryboardDesigner({ complete } as never);

    const design = await designer.design({
      ...baseInput,
      drawingStyle: "水墨漫画风",
      character: { name: "小知", persona: "科普讲解员", description: "圆框眼镜" }
    });

    expect(design.title).toBe("设计稿标题");
    const request = complete.mock.calls[0]?.[0] as unknown as {
      systemPrompt: string;
      userPayload: Record<string, unknown>;
    };
    expect(request.systemPrompt).toBe(STORYBOARD_DESIGNER_SYSTEM_PROMPT);
    expect(request.userPayload.drawingStyle).toBe("水墨漫画风");
    expect(request.userPayload.character).toEqual({
      name: "小知",
      persona: "科普讲解员",
      description: "圆框眼镜"
    });
  });

  it("anchors the ending instruction in the system prompt (D1：收尾烘进末段，不输出知识卡片)", async () => {
    expect(STORYBOARD_DESIGNER_SYSTEM_PROMPT).toContain("末段必须自然收尾");
    expect(STORYBOARD_DESIGNER_SYSTEM_PROMPT).toContain("知识卡片");
  });

  it("switches to the story comic prompt when the form is 剧情漫画", async () => {
    const complete = vi.fn(async (request: { schema: { parse: (value: unknown) => unknown } }) => {
      const raw = { title: "三只柴犬推箱子", segments: storyComicDesign().segments };
      request.schema.parse(raw);
      return raw as never;
    });
    const designer = new OpenAiStoryboardDesigner({ complete } as never);

    await designer.design({ ...baseInput, presentation: "story_comic" });
    const designRequest = complete.mock.calls[0]?.[0] as unknown as { systemPrompt: string };
    expect(designRequest.systemPrompt).toBe(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT);

    const revised = complete.mock.calls.length;
    await designer.revise({
      ...baseInput,
      presentation: "story_comic",
      currentDesign: storyComicDesign(),
      flaggedSectionKeys: []
    });
    const reviseRequest = complete.mock.calls[revised]?.[0] as unknown as { systemPrompt: string };
    expect(reviseRequest.systemPrompt).toBe(STORYBOARD_REVISER_STORY_COMIC_PROMPT);
  });

  it("anchors the group-anthropomorphism and bubble-text rules in the story comic prompts", () => {
    // 群体拟人化（R5）与「画面文字只允许对白气泡」是新形态的两条命脉，钉在提示词里防回退。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("角色可以复数");
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain(`${STORY_COMIC_MAX_SEGMENT_CHARS} 字`);
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("一段一个梗");
    // 对白画进格内气泡：prompt 末尾带「画面文字：对白气泡『台词』」，台词一字不改。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("对白气泡");
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).toContain("对白气泡");
    // 但旁白与无台词的格仍然一个字都不画。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("不要旁白框");
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).not.toContain("旁白气泡");
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).not.toContain("旁白气泡");
  });

  it("anchors the dialogue quota and two-way exchange rules in the story comic prompts", () => {
    // 2026-09-20 真机验收：提示词把 dialogue 写成「可选、宁缺毋滥」，模型就一篇对白都不写
    // （17 段全旁白独角戏）。对白密度因此升格为带数量下限的硬约束；用户同时拍板
    // 「禁止单一气泡框」——对白必须是角色之间一来一往，画面对白帧至少两只角色。
    for (const prompt of [
      STORYBOARD_DESIGNER_STORY_COMIC_PROMPT,
      STORYBOARD_REVISER_STORY_COMIC_PROMPT
    ]) {
      // 数量下限是插值，不是手抄（与段数公式同一条纪律）。
      expect(prompt).toContain(`段数 ÷ ${STORY_COMIC_SEGMENTS_PER_DIALOGUE}`);
      expect(prompt).toContain(`最少 ${STORY_COMIC_MIN_DIALOGUE_FRAMES} 个`);
      // 一来一往与禁止单一气泡的口径。
      expect(prompt).toContain("一来一往");
      expect(prompt).toContain("自问自答");
      expect(prompt).toContain("对白气泡");
    }
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("悬在半空没人认领");
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("听讲反应");
    // 「宁缺毋滥」只留给 narration——对白不再适用这个口径。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).not.toContain("宁缺毋滥），未点名");
  });

  it("anchors the budget-derived segment count in both story comic prompts", () => {
    // 回退锚点：剧情漫画提示词曾经通篇不提预算，模型于是「一章一段」——
    // 四章只写出 191 字，兑现率 19%。字段名是稳定锚点，措辞可以自由重写。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("recommendedTotalWords");
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).toContain("recommendedTotalWords");
    // 段名是内部段名（不进正文也不进图），所以每段 60 字只算 copy。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).not.toContain("title 与 copy 合计");
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).not.toContain("title 与 copy 合计");
    // 除数与段数上限都是插值进来的，不是又抄一份字面量：提示词要的段数必须落在
    // segments 数组的结构上限之内，否则模型按提示词产出也会被 schema 打回。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain(`÷ ${STORY_COMIC_WORDS_PER_SEGMENT}`);
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain(`${MAX_STORYBOARD_SEGMENTS} 段`);
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).toContain(`${MAX_STORYBOARD_SEGMENTS} 段`);
  });

  it("anchors the per-sentence limit on copy, not on frames（每句话字数）", () => {
    // 真跑踩到的坑：这条规则原来写成「每格最多一句话、不超过 15 字；每一句话都不超过 22 字」，
    // 但本形态画面里一个字都不许出现——模型于是把它读成「帧的台词规则」，写正文时按 60 字
    // 整段写成长句，21 段里 16 段踩了单句红线。现在明确挂在 copy 上。
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain("每句话");
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).toContain(
      `${STORY_COMIC_MAX_SENTENCE_CHARS} 字`
    );
    expect(STORYBOARD_DESIGNER_STORY_COMIC_PROMPT).not.toContain("每格最多一句话");
    expect(STORYBOARD_REVISER_STORY_COMIC_PROMPT).toContain(
      `${STORY_COMIC_MAX_SENTENCE_CHARS} 字`
    );
  });

  it("anchors every story comic red-line number as an interpolation（不手抄数字）", () => {
    // 这些数字原来在提示词里各抄了一份字面量（60 / 22 / 10 / 25），改红线常量时漏改一处
    // 就会出现「提示词要求 22、审核按 26 报」的错位——正是 2026-09-20 修的那类 bug。
    for (const prompt of [
      STORYBOARD_DESIGNER_STORY_COMIC_PROMPT,
      STORYBOARD_REVISER_STORY_COMIC_PROMPT
    ]) {
      expect(prompt).toContain(`${STORY_COMIC_MAX_SEGMENT_CHARS} 字`);
      expect(prompt).toContain(`${STORY_COMIC_MAX_SENTENCE_CHARS} 字`);
      expect(prompt).toContain(`${STORY_COMIC_MAX_DIALOGUE_CHARS} 字`);
      expect(prompt).toContain(`${STORY_COMIC_MAX_NARRATION_CHARS} 字`);
      // 旧的字面量不该再有残留（22 是唯一会被别的数字偶然命中的，单独盯它）。
      expect(prompt).not.toContain("不超过 22 字");
    }
  });

  it("anchors the short-card rhythm discipline in both prompts（copy 空行分块）", () => {
    expect(STORYBOARD_DESIGNER_SYSTEM_PROMPT).toContain("空行拆成 2-4 个小块");
    expect(STORYBOARD_DESIGNER_SYSTEM_PROMPT).toContain("每块只讲一件事");
    // 修订时重写的段同样要守分块节奏（写进「初版规则继续生效」的枚举里）。
    expect(STORYBOARD_REVISER_SYSTEM_PROMPT).toContain("copy 用空行拆成 2-4 个小块");
  });

  it("tells the reviser how to locate segments when review issues carry no block ids", () => {
    // 审核意见被净化后 blockIds 可能全空：修订器必须能从意见文本自行定位。
    expect(STORYBOARD_REVISER_SYSTEM_PROMPT).toContain("flaggedSectionKeys 为空");
    expect(STORYBOARD_REVISER_SYSTEM_PROMPT).toContain("message 自行判断");
  });

  it("surfaces schema violations as design failures", async () => {
    const designer = new OpenAiStoryboardDesigner({
      complete: async () => {
        throw new Error("模型返回了无效结果");
      }
    } as never);

    await expect(designer.design(baseInput)).rejects.toThrow("模型返回了无效结果");
  });
});

describe("OpenAiStoryboardDesigner.revise", () => {
  function reviseInput(): ReviseStoryboardDesignInput {
    return {
      ...baseInput,
      currentDesign: validDesign(),
      flaggedSectionKeys: ["section-2"],
      reviewFeedback: {
        status: "needs_revision",
        summary: "第二部分内容单薄",
        issues: [{ blockIds: ["block-5"], severity: "warning", message: "第三部分展开不足" }]
      }
    };
  }

  function revisingComplete(): ReturnType<typeof vi.fn> {
    return vi.fn(async (request: { schema: { parse: (value: unknown) => unknown }; userPayload: Record<string, unknown> }) => {
      const raw = {
        title: "读标题就知道讲什么",
        segments: [
          {
            sectionKey: "section-1",
            title: "什么是机会成本",
            route: "image_text",
            copy: "放弃掉的那个选项，就是你为选择付出的真实代价。",
            frames: [{ prompt: "全景。主角讲解。画面文字：对白气泡『机会成本』", altText: "机会成本讲解" }]
          },
          {
            sectionKey: "section-2",
            title: "怎么权衡",
            route: "image_text_image",
            copy: "把两个选项摆在一起，一步步比一比各自放弃什么。",
            frames: [
              { prompt: "中景。第一帧。画面文字：旁白框『先比一比』", altText: "权衡第一步" },
              { prompt: "近景。第二帧。画面文字：旁白框『再选一个』", altText: "权衡第二步" }
            ]
          }
        ]
      };
      request.schema.parse(raw);
      return raw as never;
    });
  }

  it("sends the reviser prompt with current design, flagged keys and feedback", async () => {
    const complete = revisingComplete();
    const designer = new OpenAiStoryboardDesigner({ complete } as never);

    await designer.revise(reviseInput());

    const request = complete.mock.calls[0]?.[0] as unknown as {
      systemPrompt: string;
      userPayload: Record<string, unknown>;
    };
    expect(request.systemPrompt).toBe(STORYBOARD_REVISER_SYSTEM_PROMPT);
    expect(request.userPayload.currentDesign).toEqual(reviseInput().currentDesign);
    expect(request.userPayload.flaggedSectionKeys).toEqual(["section-2"]);
    expect(request.userPayload.reviewFeedback).toMatchObject({ status: "needs_revision" });
  });

  it("trims user instructions and omits absent feedback", async () => {
    const complete = revisingComplete();
    const designer = new OpenAiStoryboardDesigner({ complete } as never);

    await designer.revise({
      ...reviseInput(),
      reviewFeedback: undefined,
      userInstructions: "  第二段换成校园场景  "
    });

    const request = complete.mock.calls[0]?.[0] as unknown as { userPayload: Record<string, unknown> };
    expect(request.userPayload.userInstructions).toBe("第二段换成校园场景");
    expect("reviewFeedback" in request.userPayload).toBe(false);
  });

  it("runs the revision through the same structural gates", async () => {
    const complete = vi.fn(async (request: { schema: { parse: (value: unknown) => unknown } }) => {
      const raw = {
        title: "读标题就知道讲什么",
        segments: [
          {
            sectionKey: "section-1",
            title: "什么是机会成本",
            route: "image_text",
            copy: "文案",
            frames: [{ prompt: "prompt", altText: "alt" }]
          },
          {
            sectionKey: "section-2",
            title: "怎么权衡",
            route: "image_text_image",
            copy: "文案",
            frames: [{ prompt: "prompt", altText: "alt" }]
          }
        ]
      };
      request.schema.parse(raw);
      return raw as never;
    });
    const designer = new OpenAiStoryboardDesigner({ complete } as never);

    // image_text_image 需要 2 帧，返回只有 1 帧：与初版同一道闸拦下。
    await expect(designer.revise(reviseInput())).rejects.toThrow("需要 2 帧分镜");
  });
});

describe("DemoStoryboardDesigner.revise", () => {
  it("rewrites only flagged segments and keeps the rest byte-identical", async () => {
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const designer = new DemoStoryboardDesigner();
    const current = await designer.design(baseInput);

    const revised = await designer.revise({
      ...baseInput,
      currentDesign: current,
      flaggedSectionKeys: [current.segments[0]!.sectionKey]
    });

    expect(revised.title).toBe(current.title);
    expect(revised.segments[0]!.copy).not.toBe(current.segments[0]!.copy);
    expect(revised.segments[1]).toEqual(current.segments[1]);
    // 未点名的段连帧一起原样保留，diff 后才能保住已生成的分镜图。
    expect(revised.segments[1]!.frames).toEqual(current.segments[1]!.frames);
  });

  it("revises every segment when the author gives personal instructions", async () => {
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const designer = new DemoStoryboardDesigner();
    const current = await designer.design(baseInput);

    const revised = await designer.revise({
      ...baseInput,
      currentDesign: current,
      flaggedSectionKeys: [],
      userInstructions: "全部换成校园场景"
    });

    for (const [index, segment] of revised.segments.entries()) {
      expect(segment.copy).not.toBe(current.segments[index]!.copy);
    }
  });
});

describe("DemoStoryboardDesigner 的剧情漫画形态", () => {
  const storyComicInput: GenerateContentInput = { ...baseInput, presentation: "story_comic" };

  it("produces short narration copy that clears the story comic red lines", async () => {
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const design = await new DemoStoryboardDesigner().design(storyComicInput);

    expect(() => validateStoryboardDesign(design, storyComicInput)).not.toThrow();
    for (const segment of design.segments) {
      // 每段 60 字只算文案：段名是内部段名，不进正文也不进图。
      expect(segment.copy.replace(/\s/g, "").length).toBeLessThanOrEqual(60);
    }
    // 群体拟人化：同一物种的复数角色一起演出。
    const frames = design.segments.flatMap((segment) => segment.frames);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.prompt.includes("三只"))).toBe(true);
    // 画字指令只允许出现在对白帧（气泡要画台词）；旁白帧与无台词帧一个字都不画。
    const dialogueFrames = frames.filter((frame) => frame.speechLine?.kind === "dialogue");
    expect(dialogueFrames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.prompt.includes("画面文字")).toBe(frame.speechLine?.kind === "dialogue");
    }
    // 末段不再追加「一句话记住」（落点由梗本身收尾，避免超出 60 字）。
    expect(design.segments.at(-1)!.copy).not.toContain("一句话记住");
  });

  it("meets the dialogue quota on a three-section outline（demo 也要过对白密度红线）", async () => {
    // 3 章是 demo 大纲生成器的固定章数：E2E 走的就是这条路径。机械红线会数对白帧，
    // demo 凑不够就会让本地与 E2E 的每一篇都变成「需要修订」。
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const { storyComicDialogueTarget } = await import("./story-comic-rules");
    const design = await new DemoStoryboardDesigner().design({
      ...storyComicInput,
      outline: [
        { id: "section-1", title: "什么是机会成本", order: 0, recommendedWords: 200 },
        { id: "section-2", title: "怎么权衡", order: 1, recommendedWords: 200 },
        { id: "section-3", title: "怎么用", order: 2, recommendedWords: 200 }
      ]
    });

    const dialogueFrames = design.segments.flatMap((segment) => segment.frames).filter(
      (frame) => frame.speechLine?.kind === "dialogue"
    );
    expect(dialogueFrames.length).toBeGreaterThanOrEqual(
      storyComicDialogueTarget(design.segments.length)
    );
    // 对白帧的台词必须原样写进 prompt（气泡里画的就是这句）。
    for (const frame of dialogueFrames) {
      expect(frame.prompt).toContain(frame.speechLine!.text);
    }
  });

  it("keeps the illustrated demo copy untouched by default", async () => {
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const design = await new DemoStoryboardDesigner().design(baseInput);
    expect(design.segments[0]!.copy).toContain("先从一个具体场景说起");
  });

  it("revises story comic segments into a different beat", async () => {
    const { DemoStoryboardDesigner } = await import("./demo-storyboard-designer");
    const designer = new DemoStoryboardDesigner();
    const current = await designer.design(storyComicInput);

    const revised = await designer.revise({
      ...storyComicInput,
      currentDesign: current,
      flaggedSectionKeys: [],
      userInstructions: "全部重来"
    });

    expect(revised.segments[0]!.copy).not.toBe(current.segments[0]!.copy);
    expect(() => validateStoryboardDesign(revised, storyComicInput)).not.toThrow();
  });
});
