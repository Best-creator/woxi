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
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "knowledge_cards",
  "science_comic_script",
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

describe("science comic script preset", () => {
  it("maps comic narration onto the block types the schema already allows", () => {
    const comic = STYLE_PRESETS.science_comic_script;

    // 分镜标题 / 画面 / 对白 / 旁白 / 干货卡，全部复用现有块类型，不需要新 schema。
    for (const blockType of ["heading", "paragraph", "quote", "callout", "knowledge_card"]) {
      expect(comic.explanationStyle).toContain(blockType);
    }
  });

  it("bans the clickbait wording the account wants to avoid", () => {
    const comic = STYLE_PRESETS.science_comic_script;

    expect(comic.avoid).toContain("悬念式标题");
    expect(comic.avoid).toContain("夸张煽动");
    expect(comic.avoid).toContain("过度商业化表达");
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
    const switched = resolveStyleProfile("science_comic_script", "", "senior_reader");

    expect(switched.preset).toBe("science_comic_script");
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
});
