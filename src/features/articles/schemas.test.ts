import { describe, expect, it } from "vitest";
import { articlePlanningSchema } from "./schemas";

function planningBody(): Record<string, unknown> {
  return {
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    confirmedOutlineRevisionId: "revision-1",
    contentOutlineRevisionId: "revision-1",
    storyboardSegments: [
      {
        id: "segment-1",
        sectionKey: "section-1",
        title: "什么是机会成本",
        route: "image_text",
        copyBlockIds: ["block-1", "block-2"],
        frameAssetIds: ["asset-1"],
        order: 0
      }
    ],
    storyboardFontId: "noto-sans",
    storyboardTextScaleId: "large",
    presentation: "story_comic"
  };
}

describe("articlePlanningSchema", () => {
  it("keeps the storyboard render settings and the presentation form", () => {
    // 整篇文章 PATCH 时 planning 会整体过一遍本 schema：没登记的可选字段会被 strip 掉，
    // 表现为「选了字号/形态，随便改一处正文就又变回默认」——所以这里逐个钉住。
    const parsed = articlePlanningSchema.parse(planningBody());
    expect(parsed.storyboardFontId).toBe("noto-sans");
    expect(parsed.storyboardTextScaleId).toBe("large");
    expect(parsed.presentation).toBe("story_comic");
    expect(parsed.storyboardSegments).toHaveLength(1);
    expect(parsed.storyboardSegments?.[0]?.copyBlockIds).toEqual(["block-1", "block-2"]);
  });

  it("accepts planning written before these fields existed", () => {
    const parsed = articlePlanningSchema.parse({
      lengthPreset: "short",
      recommendedTotalWords: null,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    });
    expect(parsed.presentation).toBeUndefined();
    expect(parsed.storyboardTextScaleId).toBeUndefined();
  });
});
