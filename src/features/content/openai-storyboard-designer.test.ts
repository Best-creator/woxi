// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBrief, OutlineSection } from "@/features/articles/domain";
import { resolveStyleProfile } from "./style-profile";
import {
  OpenAiStoryboardDesigner,
  STORYBOARD_DESIGNER_SYSTEM_PROMPT,
  STORYBOARD_REVISER_SYSTEM_PROMPT,
  validateStoryboardDesign
} from "./openai-storyboard-designer";
import type { GenerateContentInput, ReviseStoryboardDesignInput, StoryboardDesign } from "./ports";

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

  it("rejects copy that blows far past the word budget", () => {
    const design = validDesign();
    for (const segment of design.segments) {
      segment.copy = "长".repeat(700);
    }
    expect(() => validateStoryboardDesign(design, baseInput)).toThrow("超出目标");
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
