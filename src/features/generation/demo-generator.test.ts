// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DemoContentGenerator } from "./demo-generator";

describe("DemoContentGenerator", () => {
  it("returns deterministic structured content", async () => {
    const generator = new DemoContentGenerator();
    const first = await generator.generateFoundation({ topic: "复利" });
    const second = await generator.generateFoundation({ topic: "复利" });

    expect(second).toEqual(first);
    expect(first.title).toBe("用大白话讲清楚：复利");
    expect(first.outline.map((section) => section.title)).toEqual([
      "先说结论",
      "它为什么重要",
      "用一个例子理解",
      "最后总结"
    ]);
    expect(first.blocks.every((block, index) => block.order === index)).toBe(
      true
    );
    expect(
      first.blocks.some((block) => block.type === "knowledge_card")
    ).toBe(true);
  });

  it("records a bounded source excerpt in the brief", async () => {
    const generated = await new DemoContentGenerator().generateFoundation({
      topic: "复利",
      sourceContext: "【课堂笔记】\n时间会放大积累。"
    });

    expect(generated.brief.unsupportedNotes).toContain(
      "已读取资料摘录：【课堂笔记】 时间会放大积累。"
    );
  });
});
