// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBrief, OutlineSection } from "@/features/articles/domain";
import { resolveStyleProfile } from "./style-profile";
import {
  OpenAiStoryboardDesigner,
  STORYBOARD_DESIGNER_SYSTEM_PROMPT,
  validateStoryboardDesign
} from "./openai-storyboard-designer";
import type { GenerateContentInput, StoryboardDesign } from "./ports";

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

  it("surfaces schema violations as design failures", async () => {
    const designer = new OpenAiStoryboardDesigner({
      complete: async () => {
        throw new Error("模型返回了无效结果");
      }
    } as never);

    await expect(designer.design(baseInput)).rejects.toThrow("模型返回了无效结果");
  });
});
