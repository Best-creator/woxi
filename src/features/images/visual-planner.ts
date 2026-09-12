import type { ContentBlock } from "@/features/articles/domain";
import type { ImagePlanSuggestion } from "./domain";

export interface VisualPlanInput {
  title: string;
  topic: string;
  blocks: ContentBlock[];
}

export interface VisualPlanner {
  plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]>;
}
