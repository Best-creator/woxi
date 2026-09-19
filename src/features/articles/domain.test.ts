import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARTICLE_PLANNING,
  isStoryboardPresentation,
  resolveStoryboardPresentation,
  type StoryboardSegment
} from "./domain";

function segment(): StoryboardSegment {
  return {
    id: "segment-1",
    sectionKey: "section-1",
    title: "什么是机会成本",
    route: "image_text",
    copyBlockIds: ["block-1"],
    frameAssetIds: ["asset-1"],
    order: 0
  };
}

describe("isStoryboardPresentation", () => {
  it("accepts the two supported forms and rejects anything else", () => {
    expect(isStoryboardPresentation("illustrated")).toBe(true);
    expect(isStoryboardPresentation("story_comic")).toBe(true);
    expect(isStoryboardPresentation("comic")).toBe(false);
    expect(isStoryboardPresentation(null)).toBe(false);
  });
});

describe("resolveStoryboardPresentation", () => {
  it("prefers the explicit value on planning", () => {
    expect(
      resolveStoryboardPresentation({ ...DEFAULT_ARTICLE_PLANNING, presentation: "story_comic" })
    ).toBe("story_comic");
    expect(
      resolveStoryboardPresentation({ ...DEFAULT_ARTICLE_PLANNING, presentation: "illustrated" })
    ).toBe("illustrated");
  });

  it("defaults brand-new articles (no presentation, no segments) to the story comic form", () => {
    expect(resolveStoryboardPresentation({ ...DEFAULT_ARTICLE_PLANNING })).toBe("story_comic");
  });

  it("keeps articles that already have a storyboard design on the illustrated path", () => {
    // 旧文没有 presentation 字段：已经设计过分镜就说明产物是旧形态，重拼/重生成都不该变形。
    expect(
      resolveStoryboardPresentation({
        ...DEFAULT_ARTICLE_PLANNING,
        storyboardSegments: [segment()]
      })
    ).toBe("illustrated");
    // 空数组按「没设计过」处理。
    expect(
      resolveStoryboardPresentation({ ...DEFAULT_ARTICLE_PLANNING, storyboardSegments: [] })
    ).toBe("story_comic");
  });

  it("falls back by segments when the stored value is unknown", () => {
    expect(
      resolveStoryboardPresentation({
        ...DEFAULT_ARTICLE_PLANNING,
        presentation: "comic_v2",
        storyboardSegments: [segment()]
      })
    ).toBe("illustrated");
    expect(
      resolveStoryboardPresentation({ ...DEFAULT_ARTICLE_PLANNING, presentation: "comic_v2" })
    ).toBe("story_comic");
  });
});
