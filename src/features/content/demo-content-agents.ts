import type { ContentReviewResult, ContentReviewer, ReviewContentInput } from "./ports";

export class DemoContentReviewer implements ContentReviewer {
  async review(input: ReviewContentInput): Promise<ContentReviewResult> {
    const hasSource = Boolean(input.sourceContext?.trim());
    return {
      status: "passed",
      summary: `演示审核通过：${input.blocks.length} 个正文块覆盖了 ${input.outline.length} 个章节，语气为「${input.styleProfile.tone}」。配置模型后会执行真实审核。`,
      clarity: 5,
      beginnerFriendliness: 5,
      coherence: 5,
      engagement: 4,
      hookStrength: 4,
      outlineCoverage: 5,
      sourceFidelity: hasSource ? 5 : null,
      styleMatch: 4,
      issues: []
    };
  }
}
