// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoVisualPlanner } from "./demo-visual-planner";

const input = {
  title: "用大白话理解机会成本",
  topic: "机会成本",
  blocks: [
    {
      id: "process-block",
      type: "paragraph" as const,
      content: "首先列出可选方案，然后比较每个方案的收益，最后确认被放弃的最佳替代方案。",
      order: 0,
      version: 1
    },
    {
      id: "neutral-block",
      type: "paragraph" as const,
      content: "这个例子帮助理解选择需要权衡。",
      order: 1,
      version: 1
    },
    {
      id: "comparison-block",
      type: "paragraph" as const,
      content: "相比直接花钱和投入时间，两种选择的区别在于失去的替代机会不同。",
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
  it("returns a deterministic cover and process and comparison suggestions", async () => {
    const planner = new DemoVisualPlanner();

    const first = await planner.plan(input);
    const second = await planner.plan(input);

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({ type: "cover", anchorBlockId: null, aspectRatio: "cover" });
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "process", anchorBlockId: "process-block" }),
        expect.objectContaining({ type: "comparison", anchorBlockId: "comparison-block" })
      ])
    );
    expect(first.length).toBeLessThanOrEqual(12);
    expect(first.some((suggestion) => suggestion.anchorBlockId === "image-block")).toBe(false);
  });

  it("keeps only the higher-scored candidate when candidates are adjacent", async () => {
    const suggestions = await new DemoVisualPlanner().plan({
      title: "相邻候选",
      topic: "相邻候选",
      blocks: [
        {
          id: "lower-concept",
          type: "paragraph",
          content: "因为这是一种取舍关系。",
          order: 3,
          version: 1
        },
        {
          id: "higher-process",
          type: "paragraph",
          content: "首先列出步骤。",
          order: 4,
          version: 1
        }
      ]
    });

    expect(suggestions.map(({ type, anchorBlockId }) => ({ type, anchorBlockId }))).toEqual([
      { type: "cover", anchorBlockId: null },
      { type: "process", anchorBlockId: "higher-process" }
    ]);
  });

  it("orders non-adjacent equal-scored candidates by block order", async () => {
    const suggestions = await new DemoVisualPlanner().plan({
      title: "同分候选",
      topic: "同分候选",
      blocks: [
        {
          id: "later-comparison",
          type: "paragraph",
          content: "相比两种选择的区别。",
          order: 9,
          version: 1
        },
        {
          id: "earlier-process",
          type: "paragraph",
          content: "首先梳理步骤。",
          order: 2,
          version: 1
        }
      ]
    });

    expect(suggestions.map(({ type, anchorBlockId }) => ({ type, anchorBlockId }))).toEqual([
      { type: "cover", anchorBlockId: null },
      { type: "process", anchorBlockId: "earlier-process" },
      { type: "comparison", anchorBlockId: "later-comparison" }
    ]);
  });
});
