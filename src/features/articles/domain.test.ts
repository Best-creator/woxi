import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARTICLE_PLANNING,
  LENGTH_PRESET_IDS,
  LENGTH_PRESET_LABELS,
  LENGTH_RANGES,
  MAX_RECOMMENDED_WORDS,
  MIN_RECOMMENDED_WORDS,
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

/**
 * 长度档位的单一事实源守卫：加一档只改 `LENGTH_RANGES`，
 * 下拉顺序（`LENGTH_PRESET_IDS`）、显示名（`LENGTH_PRESET_LABELS`）、
 * schema 的枚举与推荐字数上下限全部由它派生——漏登记任何一处都在这里红。
 */
describe("LENGTH_RANGES 作为长度档位的唯一事实源", () => {
  it("清单与区间表一一对应：没有漏登记，也没有多余项", () => {
    expect([...LENGTH_PRESET_IDS].sort()).toEqual(Object.keys(LENGTH_RANGES).sort());
  });

  it("每一档都有显示名，且区间非空", () => {
    for (const preset of LENGTH_PRESET_IDS) {
      expect(LENGTH_PRESET_LABELS[preset]).toBeTruthy();
      expect(LENGTH_RANGES[preset].min).toBeLessThan(LENGTH_RANGES[preset].max);
    }
  });

  it("档位越长区间越大：min 与 max 都随档位不降", () => {
    const ranges = LENGTH_PRESET_IDS.map((preset) => LENGTH_RANGES[preset]);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.min).toBeGreaterThanOrEqual(ranges[index - 1]!.min);
      expect(ranges[index]!.max).toBeGreaterThan(ranges[index - 1]!.max);
    }
  });

  it("schema 的推荐字数上下限由各档区间推导", () => {
    const mins = Object.values(LENGTH_RANGES).map((range) => range.min);
    const maxs = Object.values(LENGTH_RANGES).map((range) => range.max);
    expect(MIN_RECOMMENDED_WORDS).toBe(Math.min(...mins));
    expect(MAX_RECOMMENDED_WORDS).toBe(Math.max(...maxs));
    // 下限必须落在最短档里，否则那一档自己都存不进去（600 字档踩过 min 800 的坑）。
    expect(MIN_RECOMMENDED_WORDS).toBe(550);
  });

  it("最短档是给剧情漫画体量预留的「轻量 550-650」（≈10-12 段）", () => {
    expect(LENGTH_PRESET_IDS[0]).toBe("brief");
    expect(LENGTH_RANGES.brief).toEqual({ min: 550, max: 650 });
    expect(LENGTH_PRESET_LABELS.brief).toBe("轻量");
  });

  it("新文章默认走轻量档：漫画的体量预期就是十段左右", () => {
    expect(DEFAULT_ARTICLE_PLANNING.lengthPreset).toBe("brief");
  });
});
