import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE_PROFILE,
  MAX_AVOID_ITEMS,
  STYLE_PRESET_LABELS,
  STYLE_PRESETS,
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
});
