// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MAX_RECOMMENDED_WORDS } from "@/features/articles/domain";
import { MAX_REVIEW_ISSUES, MAX_STORYBOARD_SEGMENTS, storyboardDesignSchema } from "./schemas";
import {
  STORY_COMIC_SEGMENT_TOLERANCE,
  storyComicSegmentTarget
} from "./story-comic-rules";

/**
 * 这份用例只盯一条不变量：**结构闸的段数上限必须容得下段数反推公式**。
 *
 * 2026-09-20 真实模型验收（work/hunzhi-voice-storyboard.check.test.ts）在这里翻过车：
 * 剧情漫画的提示词按 `推荐字数 ÷ 55` 反推段数，1000 字要 18 段，而 segments 数组
 * 上限还停在讲解式时代的 16——模型老老实实按提示词产出，却被 schema 判成
 * `Too big: expected array to have <=16 items`，表现为「模型写错了」，实则是闸门没跟着
 * 预算公式抬。这条守卫就是为了让下次收紧上限时必须先过这里。
 */

/** 造一份结构上合法的分镜设计，段数可控。 */
function designWithSegments(count: number) {
  return {
    title: "测试标题",
    segments: Array.from({ length: count }, (_, index) => ({
      sectionKey: `s${index}`,
      title: `段名 ${index + 1}`,
      route: "image_text_image" as const,
      copy: "狗在排队。",
      frames: [
        { prompt: "中景，三只柴犬排队", altText: "三只柴犬排队" },
        { prompt: "近景，第一只柴犬翻车", altText: "第一只柴犬翻车" }
      ]
    }))
  };
}

describe("storyboardDesignSchema 的段数上限", () => {
  it("容得下最深预算按公式反推出的段数（含浮动）", () => {
    const deepest = storyComicSegmentTarget(MAX_RECOMMENDED_WORDS) + STORY_COMIC_SEGMENT_TOLERANCE;
    expect(MAX_STORYBOARD_SEGMENTS).toBeGreaterThanOrEqual(deepest);
  });

  it("容得下 1000 字预算反推出的 18 段（真实模型验收撞过的那个数）", () => {
    expect(storyboardDesignSchema.safeParse(designWithSegments(18)).success).toBe(true);
  });

  it("上限本身是可通过的，正好多一段才被挡下", () => {
    expect(storyboardDesignSchema.safeParse(designWithSegments(MAX_STORYBOARD_SEGMENTS)).success).toBe(
      true
    );
    expect(storyboardDesignSchema.safeParse(designWithSegments(MAX_STORYBOARD_SEGMENTS + 1)).success).toBe(
      false
    );
  });

  it("零段仍然非法：结构闸的下限没被放松", () => {
    expect(storyboardDesignSchema.safeParse(designWithSegments(0)).success).toBe(false);
  });
});

describe("审核意见条数的上限", () => {
  it("装得下「每段都被贴一条红线」的极端情况", () => {
    expect(MAX_REVIEW_ISSUES).toBeGreaterThan(MAX_STORYBOARD_SEGMENTS);
  });
});
