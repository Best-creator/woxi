import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAspectRatio, ImageAssetType, ImagePlanSuggestion } from "./domain";
import type { VisualPlanInput, VisualPlanner } from "./visual-planner";

type Candidate = {
  block: ContentBlock;
  type: Exclude<ImageAssetType, "cover">;
  score: number;
};

const rules: Array<{
  pattern?: RegExp;
  type: Exclude<ImageAssetType, "cover">;
  score: number;
}> = [
  { pattern: /首先|然后|最后|步骤|过程/, type: "process", score: 4 },
  { pattern: /相比|区别|不同|共同/, type: "comparison", score: 4 },
  { pattern: /因为|所以|导致|关系|原理/, type: "concept", score: 3 },
  { type: "knowledge_card", score: 3 }
];

function summarize(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 100);
}

function prompt(topic: string, summary: string, type: ImageAssetType) {
  return `${topic}：围绕“${summary}”制作${type}类型的清晰中文信息图，无水印，适合公众号阅读。`;
}

function createCandidate(block: ContentBlock): Candidate | null {
  const rule = rules.find((item) =>
    item.type === "knowledge_card" ? block.type === "knowledge_card" : item.pattern?.test(block.content)
  );
  if (!rule) return null;

  return {
    block,
    type: rule.type,
    score: rule.score + (block.content.length >= 60 ? 1 : 0)
  };
}

export class DemoVisualPlanner implements VisualPlanner {
  async plan(input: VisualPlanInput): Promise<ImagePlanSuggestion[]> {
    const candidates = input.blocks
      .filter((block) => block.type !== "image")
      .map(createCandidate)
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((left, right) => right.score - left.score || left.block.order - right.block.order);

    const selected: Candidate[] = [];
    for (const candidate of candidates) {
      if (selected.some((item) => Math.abs(item.block.order - candidate.block.order) === 1)) {
        continue;
      }
      selected.push(candidate);
      if (selected.length === 4) break;
    }

    return [
      {
        type: "cover",
        anchorBlockId: null,
        purpose: `概览${input.topic}`,
        prompt: prompt(input.topic, input.title || input.topic, "cover"),
        altText: `${input.topic}封面图`,
        aspectRatio: "cover"
      },
      ...selected.map((candidate) => ({
        type: candidate.type,
        anchorBlockId: candidate.block.id,
        purpose: `解释${summarize(candidate.block.content)}`,
        prompt: prompt(input.topic, summarize(candidate.block.content), candidate.type),
        altText: `${input.topic}${candidate.type}图`,
        aspectRatio: (candidate.type === "knowledge_card" ? "square" : "landscape") as ImageAspectRatio
      }))
    ];
  }
}
