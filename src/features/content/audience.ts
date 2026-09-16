/**
 * 受众维度：决定「写给定谁看」。
 *
 * 与风格预设正交——风格决定怎么写（语气、句式），受众决定写给谁看（兴趣、痛点、禁忌）。
 * 之所以放在这里而不是新增文章字段：`StyleProfile` 已经被序列化进 `articles.style_json`，
 * 并且随正文版本一起快照。受众需要完全相同的快照语义（某一版正文是写给谁看的），
 * 复用同一个 JSON blob 可以不动表结构，也不用回填历史数据。
 */

export type AudienceId = "general_beginner" | "office_desk" | "senior_reader";

export interface AudienceProfile {
  id: AudienceId;
  label: string;
  /**
   * 注入生成/审核提示词的受众描述。
   * 必须自足：模型看不到界面，也不共享会话上下文。
   */
  prompt: string;
}

export const DEFAULT_AUDIENCE_ID: AudienceId = "general_beginner";

export const AUDIENCES: Record<AudienceId, AudienceProfile> = {
  general_beginner: {
    id: "general_beginner",
    label: "零基础普通读者",
    // 保持历史默认值不变：老文章的生成结果不应因为这次改动而漂移。
    prompt: "对该知识点零基础的普通读者"
  },
  office_desk: {
    id: "office_desk",
    label: "上班摸鱼族",
    prompt:
      "上班族读者：白天长时间久坐盯屏幕，靠通勤和工位上的碎片时间阅读，习惯快速扫读。" +
      "他们关心久坐与熬夜的身体代价、外卖与凑单这类日常消费决策、注意力和休息效率。" +
      "情绪上需要被理解而不是被教育：可以自嘲，不能被说教。" +
      "讲解要用工作场景（工位、外卖、满减、加班、通勤）作类比，结论要能一眼扫到、当天下班前就能用上。" +
      "禁止居高临下的健康说教、禁止喊口号、禁止暗示消费。"
  },
  senior_reader: {
    id: "senior_reader",
    label: "中老年读者",
    prompt:
      "中老年读者：关心血压血糖、关节与睡眠、保健品和养生信息的真伪、厨房与家里的日常现象。" +
      "对「被骗」和「记性变差」这类话题敏感，容易不安，所以只讲清界限，不夸大风险。" +
      "讲解要慢，要落在具体生活场景（买菜、广场舞、下楼梯、厨房、家族群）上；" +
      "任何术语出现之前必须先用生活语言解释一遍。" +
      "禁止制造恐慌、禁止暗示购买任何产品、禁止用「不看就晚了」这类施压句式。"
  }
};

export const AUDIENCE_LABELS: Record<AudienceId, string> = {
  general_beginner: AUDIENCES.general_beginner.label,
  office_desk: AUDIENCES.office_desk.label,
  senior_reader: AUDIENCES.senior_reader.label
};

const AUDIENCE_VALUES = ["general_beginner", "office_desk", "senior_reader"] as const;

export function isAudienceId(value: unknown): value is AudienceId {
  return typeof value === "string" && (AUDIENCE_VALUES as readonly string[]).includes(value);
}

/** 历史数据没有受众字段、或存了未知值时一律回落到默认受众。 */
export function resolveAudience(value: unknown): AudienceId {
  return isAudienceId(value) ? value : DEFAULT_AUDIENCE_ID;
}

/** 注入提示词的受众描述；未知值走默认受众，保证提示词永远不为空。 */
export function describeAudience(value: unknown): string {
  return AUDIENCES[resolveAudience(value)].prompt;
}
