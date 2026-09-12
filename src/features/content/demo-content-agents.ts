import type {
  ContentGenerator,
  ContentReviewResult,
  ContentReviewer,
  GenerateContentInput,
  GeneratedContent,
  GeneratedContentBlock,
  ReviewContentInput
} from "./ports";

function demoBlock(sectionKey: string, type: GeneratedContentBlock["type"], content: string, level?: 1 | 2 | 3): GeneratedContentBlock {
  return { sectionKey, type, content, ...(level ? { level } : {}) };
}

/**
 * 无 API Key 时的确定性正文生成器：不访问网络，保证本地开发和 E2E 可重复。
 * 输出结构必须与真实生成器一致——按已确认大纲顺序、逐章节、带 sectionKey。
 */
export class DemoContentGenerator implements ContentGenerator {
  async generate(input: GenerateContentInput): Promise<GeneratedContent> {
    const blocks: GeneratedContentBlock[] = [];
    for (const section of input.outline) {
      const goal = section.goal?.trim() || section.title;
      blocks.push(demoBlock(section.id, "heading", section.title, 2));
      blocks.push(demoBlock(
        section.id,
        "paragraph",
        `先从一个具体场景说起：${goal}。把这件事放到日常里看，它并不抽象。`
      ));
      blocks.push(demoBlock(
        section.id,
        "paragraph",
        `说清楚${section.title}之后，下一步就能自然地接到后面的内容。`
      ));
    }
    if (blocks.length && input.brief.oneSentence) {
      blocks.push(demoBlock(input.outline[0].id, "callout", `一句话记住：${input.brief.oneSentence}`));
    }
    // 与旧版演示生成器保持一致的成稿标题，方便本地与 E2E 断言。
    return { title: `用大白话讲清楚：${input.topic}`, blocks };
  }
}

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
      outlineCoverage: 5,
      sourceFidelity: hasSource ? 5 : null,
      styleMatch: 4,
      issues: []
    };
  }
}
