import type {
  ContentBlock,
  KnowledgeBrief,
  LengthPreset,
  OutlineSection
} from "@/features/articles/domain";

export interface GeneratedFoundation {
  title: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  blocks: ContentBlock[];
}

export interface GeneratedArticleContent {
  title: string;
  blocks: ContentBlock[];
}

export interface GenerateArticleContentInput {
  topic: string;
  brief: KnowledgeBrief;
  outline: OutlineSection[];
  lengthPreset: LengthPreset;
  sourceContext?: string;
  model?: string;
}

/** Generates article blocks from an already confirmed Knowledge Brief and outline. */
export interface ContentGenerator {
  generate(input: GenerateArticleContentInput): Promise<GeneratedArticleContent>;
}

/** Temporary compatibility contract used by the legacy foundation route until Task 2 rewires it. */
export interface LegacyContentGenerator {
  generateFoundation(input: {
    topic: string;
    sourceContext?: string;
  }): Promise<GeneratedFoundation>;
}
