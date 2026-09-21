import { AUDIENCE_LABELS, DEFAULT_AUDIENCE_ID, resolveAudience, type AudienceId } from "./audience";

/**
 * 预设的单一事实源：数组顺序 = 界面「人物语言风格」下拉里的顺序。
 *
 * 加一个新文风只改本文件三处——① 加进这个数组 ② `STYLE_PRESET_LABELS` 加标签
 * ③ `STYLE_PRESETS` 加定义。`StylePreset` 联合类型、`isStylePreset`、
 * `schemas.ts` 的 `stylePresetSchema`、界面的下拉选项全部由这里派生，
 * **不要再手抄第二份 id 列表**（旧写法散在 4 处，漏一处就是 400 或下拉里看不见）。
 */
export const STYLE_PRESET_IDS = [
  "popular_science_teacher",
  "plain_explainer",
  "rational_analyst",
  "friend_chat",
  "storyteller",
  "funny_storyteller",
  "hunzhi_comic",
  "knowledge_cards",
  "custom"
] as const;

export type StylePreset = (typeof STYLE_PRESET_IDS)[number];

/**
 * 幽默程度。`high` 是给「搞笑剧情解说」用的：允许并鼓励段子与吐槽，
 * 与 moderate（朋友聊天式的轻幽默）区分开。
 */
export type HumorLevel = "none" | "light" | "moderate" | "high";
export type QuestionFrequency = "low" | "moderate" | "high";
export type ContentDensity = "low" | "medium" | "high";

export interface StyleProfile {
  preset: StylePreset;
  /** 写给谁看；与 preset（怎么写）正交，两者互不覆盖。 */
  audience: AudienceId;
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

/**
 * 预设只描述「怎么写」，不含受众——受众是独立维度，
 * 因此预设常量里不重复 6 遍同样的默认值，由 resolveStyleProfile 统一补上。
 */
export type StylePresetShape = Omit<StyleProfile, "audience">;

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 1_000;
export const MAX_AVOID_ITEMS = 12;
export const MAX_AVOID_ITEM_LENGTH = 100;

export const STYLE_PRESET_LABELS: Record<StylePreset, string> = {
  popular_science_teacher: "通俗科普老师",
  plain_explainer: "大白话科普者",
  rational_analyst: "理性分析者",
  friend_chat: "朋友聊天式",
  storyteller: "故事讲述者",
  funny_storyteller: "搞笑剧情解说",
  hunzhi_comic: "混知风吐槽漫画",
  knowledge_cards: "简洁知识卡片",
  custom: "自定义"
};

export const STYLE_PRESETS: Record<Exclude<StylePreset, "custom">, StylePresetShape> = {
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
  plain_explainer: {
    preset: "plain_explainer",
    persona: "把复杂知识翻成大白话的科普解说者，讲什么都像在放一段看得懂的小动画",
    tone: "接地气、轻松、有画面感；不端着、不装、不唬人",
    readerAddress: "你",
    sentenceStyle: "大白话短句为主；复杂概念先用生活画面讲出来，再给概念名称，禁止术语先行",
    // 「动漫感」落在文风层面：像动画旁白一样有画面、有情节地讲述，但结构仍是讲解式图文卡。
    // 需要「一段一个梗 + 群体拟人化演出」的剧情漫画编排，由呈现形态（planning.presentation =
    // story_comic）与「搞笑剧情解说」预设负责；这里保持纯文风，不引入分镜结构。
    explanationStyle:
      "每个知识点都按「先画面、再拆解、后回生活」讲：先用一段像动画旁白的具体场景把读者拉进来——谁、在哪、发生了什么；" +
      "再用大白话一层层拆开背后的机制，比喻只取吃饭、通勤、手机、家务这类日常事物；" +
      "术语第一次出现必须用大白话定义，之后才能使用。" +
      "「后回生活」指把机制落进一个读者亲眼见过的具体物件或场景（蜂蜜瓶底结的砂糖、洗衣机甩干、路由器发热），让机制在场景里自己显形；" +
      "禁止用「这对你的日常生活意味着什么」这类模板句开头，禁止把科学概念拔高成做人道理；" +
      "找不到贴切的生活场景就停在拆解，宁可不迁移也不硬凑。",
    humorLevel: "light",
    questionFrequency: "moderate",
    contentDensity: "medium",
    customInstructions: "",
    avoid: ["术语先行", "书面腔翻译腔", "堆数据不解释", "说教口吻", "比喻只有壳没原理", "故弄玄虚", "强行联系生活"]
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
  funny_storyteller: {
    preset: "funny_storyteller",
    persona: "会写段子的漫画编剧，最擅长把知识点编成一群小角色的搞笑日常",
    tone: "幽默、有节奏、全是口语；吐槽点到为止，不贫嘴、不掉书袋",
    readerAddress: "你",
    sentenceStyle: "全部口语短句，一句话只说一件事，不写超过 30 字的长句",
    explanationStyle:
      "一段一个梗：先用反常或荒谬的画面把人拽进来——谁在干什么、结果翻了个什么车；" +
      "再让角色用一句大白话把道理点破。只讲一条因果链，分支细节一律砍掉；" +
      "笑点来自角色的反应与翻车，不来自形容词堆砌；术语第一次出现前必须先用大白话说过一遍。",
    humorLevel: "high",
    questionFrequency: "low",
    contentDensity: "low",
    customInstructions: "",
    avoid: ["教科书式解释", "超过 30 字的长句", "术语先行", "平铺直叙", "并列列举"]
  },
  /**
   * 混知风（职场吐槽漫画科普）。取自 style-lab 对混知长图的真实提炼
   * （113 张图文 → OCR 转写 → 画像），与「搞笑剧情解说」的区别是：
   * 那个只管「一段一个梗」，这个把古人 / 学科整体拟成班级或公司、
   * 给角色套现代外号，是**群体拟人化演出**那一套。
   *
   * ⚠️ 这是第一个自带 `customInstructions` 的预设——字段装不下的招牌手法与常用词放在这里。
   * 保它不被抹掉的逻辑在 `resolveStyleProfile`（空串 = 保留预设自带那份），改那个函数时务必顾及。
   */
  hunzhi_comic: {
    preset: "hunzhi_comic",
    persona:
      "自称混子哥的理工直男知识团队：嬉皮笑脸画漫画，骨子里在扫知识盲区，" +
      "对读者像带同学划重点的损友班长。",
    tone: "口语调侃、自嘲吐槽，史实用职场黑话和网络梗套着讲，讲完立刻金句或对白切断，偶尔收成正经口号。",
    readerAddress: "你 / 大家 / 同学 / 朋友",
    sentenceStyle:
      "旁白一句一行，模仿漫画分镜；对白极短、纯口语。知识点处突然拉成两三句解释，" +
      "随即用一句金句或吐槽收束。节奏是：短旁白 → 更短对白 → 金句，几乎不做长段落。",
    explanationStyle:
      "先抛当代钩子（网红皇帝/打嘴炮/用户思维），再给人物贴现代身份（斜杠青年、杠精 N 号、朱总），" +
      "用对白演冲突，穿插职场黑话解释制度，最后用当代金句或选择题把知识点钉死。",
    humorLevel: "high",
    questionFrequency: "moderate",
    contentDensity: "high",
    // 只放字段里没有的东西（招牌手法 + 常用词），人设/语气/句式/避免都在上面的字段里，
    // 这里再抄一遍只会挤掉真正独有的内容——describeStyleProfile 会把两者一起送进提示词。
    customInstructions:
      "写作风格：把古人塞进职场/班级，用短对白和当代黑话把知识点讲成分镜段子。\n" +
      "必须用的招牌手法：把朝代/学派整体拟成班级或公司，用座位、职务、党争对应权力结构，" +
      "让制度冲突一眼看懂；给人物套现代外号和职级（朱总、毕姥爷、杠精 1 号、大明最强守门员），" +
      "用身份反差降低记忆成本；用当代生活痛点句给史实打标签（充电两小时开机就黑屏、" +
      "肉体是国家的灵魂却是宜家的），把冷知识钉在读者已有的体验上；" +
      "旁白刚讲完一段立刻切一句广告语或口号（吸阉有害健康、气不气？），用吐槽切断说教；" +
      "把官制沿革画成组织架构加职场黑话，用公司逻辑解释皇权；" +
      "标题用「不懂 X 还 Y」或「为了 Z 他们打嘴炮」把知识包装成吐槽，而不是课题名。\n" +
      "多用这类词：混子哥、二混子、嘴炮、杠精、朱总、气不气、你仔细品、斜杠青年、用户思维、" +
      "鸡贼、键盘侠、北漂、夕阳产业、装比、大 V、正式工、打卡、开车。",
    avoid: [
      "连续三句以上不夹对白或吐槽的编年体叙述",
      "标题用浅谈/论/探析/刍议",
      "对历史人物做纯道德审判而不给外号、不打当代标签",
      "学术注释、参考文献、纪年对照表",
      "把制度讲成说明书条目而不画成公司架构/班级座位",
      "温情鸡汤或励志金句收尾（物极必反这类口号仅出现在品牌文）",
      "客服腔称呼：亲爱的用户、各位观众",
      "把古人对话写成文言文或翻译腔",
      "解释梗、解释黑话、解释为什么好笑"
    ]
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

export const DEFAULT_STYLE_PROFILE: StyleProfile = {
  ...STYLE_PRESETS.popular_science_teacher,
  audience: DEFAULT_AUDIENCE_ID
};

/** 旧数据没有 style_json 列时回落到默认风格，保证升级后仍可读。 */
export function parseStyleProfileJson(styleJson: string | null | undefined): StyleProfile {
  if (!styleJson) return { ...DEFAULT_STYLE_PROFILE };
  try {
    const parsed = { ...DEFAULT_STYLE_PROFILE, ...(JSON.parse(styleJson) as Partial<StyleProfile>) };
    // 兼容本次改动之前写入的行：它们没有 audience 字段，或存了已废弃的取值。
    // preset 也可能存有后来移除的预设（如 science_comic_script）——回落成 custom，
    // 保留行内其余风格字段，旧文章打开后仍可编辑保存，不会在校验层被拒。
    const preset = isStylePreset(parsed.preset) ? parsed.preset : "custom";
    return { ...parsed, preset, audience: resolveAudience(parsed.audience) };
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
    audience: resolveAudience(profile.audience),
    customInstructions: clampText(profile.customInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH),
    avoid: sanitizeAvoid(profile.avoid)
  };
}

export function isStylePreset(value: unknown): value is StylePreset {
  return typeof value === "string" && (STYLE_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * 预设只决定风格骨架；自定义说明只对 `custom` 生效，其他预设下作为补充约束保留。
 * `audience` 独立于预设：切换风格时必须显式把当前受众传进来，否则会被重置回默认受众。
 *
 * **预设自带的 `customInstructions` 优先于空串**：内置预设（如混知风）把字段装不下的
 * 招牌手法、常用词寄存在这个字段里，而界面切预设时传进来的往往就是空串——若无条件覆盖，
 * 预设一被选中就会被抹掉骨架里最独特的那部分。调用方给了新说明仍按「补充约束」覆盖；
 * 没给（空串）则保留预设自带的那份。
 */
export function resolveStyleProfile(
  preset: StylePreset,
  customInstructions = "",
  audience: AudienceId = DEFAULT_AUDIENCE_ID
): StyleProfile {
  const instructions = clampText(customInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  const resolvedAudience = resolveAudience(audience);
  if (preset === "custom") {
    return {
      ...STYLE_PRESETS.popular_science_teacher,
      preset: "custom",
      audience: resolvedAudience,
      customInstructions: instructions
    };
  }
  const skeleton = STYLE_PRESETS[preset];
  return {
    ...skeleton,
    audience: resolvedAudience,
    customInstructions: instructions || skeleton.customInstructions
  };
}

export function describeStyleProfile(profile: StyleProfile): string {
  const lines = [
    `人物：${profile.persona}`,
    `语气：${profile.tone}`,
    `受众：${AUDIENCE_LABELS[resolveAudience(profile.audience)]}`,
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
