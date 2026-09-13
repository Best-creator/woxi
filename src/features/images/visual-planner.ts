import type { ContentBlock } from "@/features/articles/domain";
import type { ImagePlanSuggestion } from "./domain";

/** 参考形象摘要：注入规划提示词，让所有配图共用同一主角。 */
export interface VisualCharacterBrief {
  name: string;
  persona: string;
  description: string;
}

export interface VisualPlanInput {
  title: string;
  topic: string;
  blocks: ContentBlock[];
  /** 绘制风格；缺省时由模型自行决定。 */
  style?: string;
  /** 参考形象；缺省时不强制统一主角。 */
  character?: VisualCharacterBrief;
  /** 覆盖规划模型；缺省时用服务端默认（LLM_VISUAL_MODEL 或主模型）。 */
  model?: string;
}

export interface VisualPlanner {
  plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]>;
}
