// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoVisualPlanner } from "./demo-visual-planner";

const long = (text: string) => text.repeat(3);

const input = {
  title: "用大白话理解机会成本",
  topic: "机会成本",
  blocks: [
    {
      id: "process-block",
      type: "paragraph" as const,
      content: long("首先列出可选方案，然后比较每个方案的收益，最后确认被放弃的最佳替代方案。"),
      order: 0,
      version: 1
    },
    {
      id: "short-block",
      type: "paragraph" as const,
      content: "这句话太短，不需要配图。",
      order: 1,
      version: 1
    },
    {
      id: "comparison-block",
      type: "paragraph" as const,
      content: long("相比直接花钱和投入时间，两种选择的区别在于失去的替代机会不同。"),
      order: 2,
      version: 1
    },
    {
      id: "image-block",
      type: "image" as const,
      content: "/api/image-assets/old-image/content",
      altText: "已有图片",
      assetId: "old-image",
      order: 3,
      version: 1
    }
  ]
};

describe("DemoVisualPlanner", () => {
  it("returns a deterministic cover followed by ordered storyboard frames", async () => {
    const planner = new DemoVisualPlanner();

    const first = await planner.plan(input);
    const second = await planner.plan(input);

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({ type: "cover", anchorBlockId: null, aspectRatio: "cover" });
    // 分镜按正文顺序编号，景别与序号编进 purpose/prompt。
    expect(first[1]).toMatchObject({
      type: "storyboard",
      anchorBlockId: "process-block",
      aspectRatio: "landscape"
    });
    expect(first[1].purpose).toContain("分镜 1");
    expect(first[1].prompt).toContain("第 1 格");
    expect(first[2]).toMatchObject({
      type: "storyboard",
      anchorBlockId: "comparison-block",
      aspectRatio: "portrait"
    });
    expect(first[2].purpose).toContain("分镜 2");
    expect(first.some((suggestion) => suggestion.anchorBlockId === "image-block")).toBe(false);
    expect(first.some((suggestion) => suggestion.anchorBlockId === "short-block")).toBe(false);
  });

  it("skips short paragraphs that do not need a visual explanation", async () => {
    const suggestions = await new DemoVisualPlanner().plan({
      title: "全短句",
      topic: "全短句",
      blocks: [
        { id: "a", type: "paragraph", content: "太短。", order: 0, version: 1 },
        { id: "b", type: "paragraph", content: "也很短。", order: 1, version: 1 }
      ]
    });

    expect(suggestions.map(({ type }) => type)).toEqual(["cover"]);
  });

  it("keeps only the first frame when explainable paragraphs are adjacent", async () => {
    const suggestions = await new DemoVisualPlanner().plan({
      title: "相邻段落",
      topic: "相邻段落",
      blocks: [
        {
          id: "first",
          type: "paragraph",
          content: long("第一段需要解释的内容足够长。"),
          order: 3,
          version: 1
        },
        {
          id: "second",
          type: "paragraph",
          content: long("第二段同样需要解释而且紧跟第一段。"),
          order: 4,
          version: 1
        }
      ]
    });

    expect(suggestions.map(({ type, anchorBlockId }) => ({ type, anchorBlockId }))).toEqual([
      { type: "cover", anchorBlockId: null },
      { type: "storyboard", anchorBlockId: "first" }
    ]);
  });
});
