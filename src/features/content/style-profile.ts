export type StylePreset =
  | "popular_science_teacher"
  | "rational_analyst"
  | "friend_chat"
  | "storyteller"
  | "knowledge_cards"
  | "custom";

export type HumorLevel = "none" | "light" | "moderate";
export type QuestionFrequency = "low" | "moderate" | "high";
export type ContentDensity = "low" | "medium" | "high";

export interface StyleProfile {
  preset: StylePreset;
  persona: string;
  tone: string;
  readerAddress: string;
  sentenceStyle: string;
  explanationStyle: string;
  humorLevel: HumorLevel;
  questionFrequency: QuestionFrequency;
  contentDensity: ContentDensity;
  customInstructions: string;
  avoid: string[];
}

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 1_000;
export const MAX_AVOID_ITEMS = 12;
export const MAX_AVOID_ITEM_LENGTH = 100;

export const STYLE_PRESET_LABELS: Record<StylePreset, string> = {
  popular_science_teacher: "通俗科普老师",
  rational_analyst: "理性分析者",
  friend_chat: "朋友聊天式",
  storyteller: "故事讲述者",
  knowledge_cards: "简洁知识卡片",
  custom: "自定义"
};

export const STYLE_PRESETS: Record<Exclude<StylePreset, "custom">, StyleProfile> = {
  popular_science_teacher: {
    preset: "popular_science_teacher",
    persona: "善于用生活案例讲知识的科普老师",
    tone: "亲切、自然、有耐心",
    readerAddress: "你",
    sentenceStyle: "短句为主，避免连续长段落",
    explanationStyle: "先场景，再解释，再给出概念名称",
    humorLevel: "light",
    questionFrequency: "moderate",
    contentDensity: "medium",
    customInstructions: "",
    avoid: ["说教口吻", "堆砌专业术语", "空泛鸡汤", "夸张结论"]
  },
  rational_analyst: {
    preset: "rational_analyst",
    persona: "习惯先划清边界再下结论的理性分析者",
    tone: "冷静、克制、就事论事",
    readerAddress: "你",
    sentenceStyle: "以陈述句为主，一句话只承载一个判断",
    explanationStyle: "先给定义和前提，再给推导，最后给结论",
    humorLevel: "none",
    questionFrequency: "low",
    contentDensity: "high",
    customInstructions: "",
    avoid: ["情绪化表达", "未定义就使用术语", "以偏概全", "省略前提"]
  },
  friend_chat: {
    preset: "friend_chat",
    persona: "坐在你对面聊天的朋友",
    tone: "亲切、自然、像朋友聊天",
    readerAddress: "你",
    sentenceStyle: "口语化短句，多用停顿和转折",
    explanationStyle: "先讲一件具体的事，再顺着聊到背后的原理",
    humorLevel: "moderate",
    questionFrequency: "moderate",
    contentDensity: "low",
    customInstructions: "",
    avoid: ["书面套话", "端着说话", "大段定义", "强行煽情"]
  },
  storyteller: {
    preset: "storyteller",
    persona: "用具体人物和情节推进讲解的讲述者",
    tone: "生动、有画面感、节奏感强",
    readerAddress: "你",
    sentenceStyle: "长短句交替，关键处用短句收束",
    explanationStyle: "先铺一个具体情境，让人物做出选择，再揭示背后的概念",
    humorLevel: "light",
    questionFrequency: "moderate",
    contentDensity: "medium",
    customInstructions: "",
    avoid: ["流水账式叙事", "只有情节没有概念", "人物动机模糊", "结尾强行升华"]
  },
  knowledge_cards: {
    preset: "knowledge_cards",
    persona: "把知识压缩成可扫读卡片的结构化作者",
    tone: "简洁、直接、不铺陈",
    readerAddress: "你",
    sentenceStyle: "一句一条，能用列表就不用成段铺陈",
    explanationStyle: "先给结论或定义，再列要点，最后补一个例子",
    humorLevel: "none",
    questionFrequency: "low",
    contentDensity: "high",
    customInstructions: "",
    avoid: ["冗长铺垫", "重复同一观点", "模糊表述", "口语废话"]
  }
};

export const DEFAULT_STYLE_PROFILE: StyleProfile = STYLE_PRESETS.popular_science_teacher;

/** 旧数据没有 style_json 列时回落到默认风格，保证升级后仍可读。 */
export function parseStyleProfileJson(styleJson: string | null | undefined): StyleProfile {
  if (!styleJson) return { ...DEFAULT_STYLE_PROFILE };
  try {
    return { ...DEFAULT_STYLE_PROFILE, ...(JSON.parse(styleJson) as Partial<StyleProfile>) };
  } catch {
    return { ...DEFAULT_STYLE_PROFILE };
  }
}

function clampText(value: string, max: number) {
  return value.trim().slice(0, max);
}

export function sanitizeAvoid(avoid: readonly string[]): string[] {
  return avoid
    .map((item) => clampText(item, MAX_AVOID_ITEM_LENGTH))
    .filter((item) => item.length > 0)
    .slice(0, MAX_AVOID_ITEMS);
}

export function sanitizeStyleProfile(profile: StyleProfile): StyleProfile {
  return {
    ...profile,
    preset: profile.preset,
    customInstructions: clampText(profile.customInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH),
    avoid: sanitizeAvoid(profile.avoid)
  };
}

const STYLE_PRESET_VALUES = [
  "popular_science_teacher",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "knowledge_cards",
  "custom"
] as const;

export function isStylePreset(value: unknown): value is StylePreset {
  return typeof value === "string" && (STYLE_PRESET_VALUES as readonly string[]).includes(value);
}

/** 预设只决定风格骨架；自定义说明只对 `custom` 生效，其他预设下作为补充约束保留。 */
export function resolveStyleProfile(
  preset: StylePreset,
  customInstructions = ""
): StyleProfile {
  const instructions = clampText(customInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  if (preset === "custom") {
    return {
      ...STYLE_PRESETS.popular_science_teacher,
      preset: "custom",
      customInstructions: instructions
    };
  }
  return {
    ...STYLE_PRESETS[preset],
    customInstructions: instructions
  };
}

export function describeStyleProfile(profile: StyleProfile): string {
  const lines = [
    `人物：${profile.persona}`,
    `语气：${profile.tone}`,
    `称呼读者：${profile.readerAddress}`,
    `句式：${profile.sentenceStyle}`,
    `讲解方式：${profile.explanationStyle}`,
    `幽默程度：${profile.humorLevel}`,
    `提问频率：${profile.questionFrequency}`,
    `信息密度：${profile.contentDensity}`
  ];
  if (profile.avoid.length) lines.push(`避免：${profile.avoid.join("、")}`);
  if (profile.customInstructions) lines.push(`补充要求：${profile.customInstructions}`);
  return lines.join("\n");
}
