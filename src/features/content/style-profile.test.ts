import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE_PROFILE,
  MAX_AVOID_ITEMS,
  STYLE_PRESET_LABELS,
  STYLE_PRESETS,
  describeStyleProfile,
  parseStyleProfileJson,
  resolveStyleProfile,
  sanitizeStyleProfile,
  type StylePreset
} from "./style-profile";

const ALL_PRESETS: StylePreset[] = [
  "popular_science_teacher",
  "plain_explainer",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "knowledge_cards",
  "custom"
];

describe("style presets", () => {
  it("describes every preset with a complete profile", () => {
    for (const preset of ALL_PRESETS) {
      expect(STYLE_PRESET_LABELS[preset]).toBeTruthy();
    }
    for (const [preset, profile] of Object.entries(STYLE_PRESETS)) {
      expect(profile.preset).toBe(preset);
      expect(profile.persona.length).toBeGreaterThan(0);
      expect(profile.tone.length).toBeGreaterThan(0);
      expect(profile.avoid.length).toBeGreaterThan(0);
      expect(profile.avoid.length).toBeLessThanOrEqual(MAX_AVOID_ITEMS);
    }
  });

  it("uses the popular science teacher as the default profile", () => {
    expect(DEFAULT_STYLE_PROFILE.preset).toBe("popular_science_teacher");
    expect(DEFAULT_STYLE_PROFILE.tone).toBe("亲切、自然、有耐心");
    expect(DEFAULT_STYLE_PROFILE.audience).toBe("general_beginner");
  });

  it("keeps audience out of the preset constants so the two dimensions stay orthogonal", () => {
    for (const profile of Object.values(STYLE_PRESETS)) {
      expect(profile).not.toHaveProperty("audience");
    }
  });
});

describe("plain explainer preset", () => {
  it("explains through everyday scenes first and lands back in daily life", () => {
    const plain = STYLE_PRESETS.plain_explainer;

    // 「先画面、再拆解、后回生活」是大白话科普的骨架：术语必须晚于画面出现。
    expect(plain.explanationStyle).toContain("先画面");
    expect(plain.explanationStyle).toContain("后回生活");
    expect(plain.explanationStyle).toContain("术语第一次出现必须用大白话定义");
    expect(plain.sentenceStyle).toContain("禁止术语先行");
    expect(plain.avoid).toContain("术语先行");

    // 「每讲完一个概念都落一句模板句」的机械指令已废除：生活迁移必须有纪律，
    // 找不到贴切场景宁可不迁移，不许硬凑（用户实测它只会产出牵强鸡汤）。
    expect(plain.explanationStyle).not.toContain("每讲完一个概念");
    expect(plain.explanationStyle).toContain("宁可不迁移也不硬凑");
    expect(plain.avoid).toContain("强行联系生活");
  });

  it("keeps the anime feel at the prose level, not as storyboard structure", () => {
    const plain = STYLE_PRESETS.plain_explainer;

    // 动漫感只允许出现在「像动画旁白」的画面叙事里；
    // 分镜结构已被移除且用户明确不再往分镜化方向加，这里要钉死边界。
    expect(plain.explanationStyle).toContain("像动画旁白");
    expect(plain.explanationStyle).not.toContain("分镜");
  });
});

describe("resolveStyleProfile", () => {
  it("merges custom instructions into a named preset", () => {
    expect(resolveStyleProfile("friend_chat", "少用反问句")).toMatchObject({
      preset: "friend_chat",
      tone: "亲切、自然、像朋友聊天",
      customInstructions: "少用反问句"
    });
  });

  it("builds a custom profile from instructions", () => {
    expect(resolveStyleProfile("custom", "像耐心的高中老师一样解释")).toMatchObject({
      preset: "custom",
      customInstructions: "像耐心的高中老师一样解释"
    });
  });

  it("trims instructions and clips them to the length limit", () => {
    const resolved = resolveStyleProfile("custom", `  ${"啰".repeat(1_200)}  `);

    expect(resolved.customInstructions.length).toBe(1_000);
    expect(resolved.customInstructions.endsWith("啰")).toBe(true);
  });

  it("does not mutate the shared preset constants", () => {
    resolveStyleProfile("storyteller", "加一点悬念");

    expect(STYLE_PRESETS.storyteller.customInstructions).toBe("");
  });

  it("defaults to the general audience when the caller does not pass one", () => {
    expect(resolveStyleProfile("friend_chat").audience).toBe("general_beginner");
  });

  it("carries the chosen audience across a preset switch", () => {
    const switched = resolveStyleProfile("storyteller", "", "senior_reader");

    expect(switched.preset).toBe("storyteller");
    expect(switched.audience).toBe("senior_reader");
  });
});

describe("describeStyleProfile", () => {
  it("states the audience with its readable label", () => {
    expect(describeStyleProfile(resolveStyleProfile("friend_chat", "", "office_desk"))).toContain(
      "受众：上班摸鱼族"
    );
  });
});

describe("sanitizeStyleProfile", () => {
  it("clips avoid items and drops empty entries", () => {
    const sanitized = sanitizeStyleProfile({
      ...DEFAULT_STYLE_PROFILE,
      avoid: [...Array.from({ length: 15 }, (_, index) => `规则${index}`), "   "]
    });

    expect(sanitized.avoid).toHaveLength(MAX_AVOID_ITEMS);
    expect(sanitized.avoid[0]).toBe("规则0");
    expect(sanitized.avoid.every((item) => item.length <= 100)).toBe(true);
  });

  it("normalizes an unknown audience back to the default", () => {
    const sanitized = sanitizeStyleProfile({
      ...DEFAULT_STYLE_PROFILE,
      audience: "office-slacker" as never
    });

    expect(sanitized.audience).toBe("general_beginner");
  });
});

describe("parseStyleProfileJson", () => {
  it("falls back to the default profile for legacy rows", () => {
    expect(parseStyleProfileJson(null).preset).toBe("popular_science_teacher");
    expect(parseStyleProfileJson("").preset).toBe("popular_science_teacher");
    expect(parseStyleProfileJson("{ not json").preset).toBe("popular_science_teacher");
  });

  it("keeps stored fields and fills missing ones from the default", () => {
    const parsed = parseStyleProfileJson(JSON.stringify({ preset: "rational_analyst", tone: "冷静、克制、就事论事" }));

    expect(parsed.preset).toBe("rational_analyst");
    expect(parsed.tone).toBe("冷静、克制、就事论事");
    expect(parsed.readerAddress).toBe(DEFAULT_STYLE_PROFILE.readerAddress);
  });

  it("fills the audience for rows written before the audience dimension existed", () => {
    expect(parseStyleProfileJson(JSON.stringify({ preset: "friend_chat" })).audience).toBe("general_beginner");
    expect(parseStyleProfileJson(null).audience).toBe("general_beginner");
  });

  it("keeps a stored audience and rejects an unknown one", () => {
    expect(
      parseStyleProfileJson(JSON.stringify({ preset: "friend_chat", audience: "senior_reader" })).audience
    ).toBe("senior_reader");
    expect(
      parseStyleProfileJson(JSON.stringify({ preset: "friend_chat", audience: "office-slacker" })).audience
    ).toBe("general_beginner");
  });

  it("falls back to custom for rows written with a since-removed preset", () => {
    // 旧版曾提供「科普漫画脚本」预设；移除后历史行不能在校验层被拒，风格字段原样保留。
    const parsed = parseStyleProfileJson(
      JSON.stringify({ preset: "science_comic_script", persona: "漫画脚本作者" })
    );

    expect(parsed.preset).toBe("custom");
    expect(parsed.persona).toBe("漫画脚本作者");
  });
});
