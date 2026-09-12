import type {
  GeneratedOutline,
  GenerateOutlineInput,
  OutlineReviewResult,
  ReviewOutlineInput
} from "./domain";

export interface OutlineGenerator {
  generate(input: GenerateOutlineInput): Promise<GeneratedOutline>;
}

export interface OutlineReviewer {
  review(input: ReviewOutlineInput): Promise<OutlineReviewResult>;
}
