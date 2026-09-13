import type { ContentBlock } from "@/features/articles/domain";
import type { ImagePlanSuggestion } from "./domain";

export interface VisualPlanInput {
  title: string;
  topic: string;
  blocks: ContentBlock[];
  /** 覆盖规划模型；缺省时用服务端默认（LLM_VISUAL_MODEL 或主模型）。 */
  model?: string;
}

export interface VisualPlanner {
  plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]>;
}
