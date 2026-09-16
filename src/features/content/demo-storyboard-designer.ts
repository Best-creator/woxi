import type { StoryboardRoute } from "@/features/articles/domain";
import type {
  GenerateContentInput,
  StoryboardDesign,
  StoryboardDesigner,
  StoryboardDesignSegment
} from "./ports";

/**
 * 无 API Key 时的确定性分镜设计器：不访问网络，保证本地开发和 E2E 可重复。
 * 结构与真实设计器一致：逐大纲章节一个分镜段，路由覆盖三种排法
 * （首段 图+文，中段 图+文+图，末段 文+图），文案沿用旧演示生成器的文本。
 */
export class DemoStoryboardDesigner implements StoryboardDesigner {
  async design(input: GenerateContentInput): Promise<StoryboardDesign> {
    const segments: StoryboardDesignSegment[] = input.outline.map((section, index) => {
      const goal = section.goal?.trim() || section.title;
      const copy =
        `先从一个具体场景说起：${goal}。把这件事放到日常里看，它并不抽象。` +
        `说清楚${section.title}之后，下一步就能自然地接到后面的内容。`;
      const route = demoRouteFor(index, input.outline.length);
      return {
        sectionKey: section.id,
        title: section.title,
        route,
        copy,
        frames: demoFrames(route, section.title, goal)
      };
    });
    const last = segments[segments.length - 1];
    if (last && input.brief.oneSentence) {
      last.copy = `${last.copy}一句话记住：${input.brief.oneSentence}`;
    }
    // 与旧版演示生成器保持一致的成稿标题，方便本地与 E2E 断言。
    return { title: `用大白话讲清楚：${input.topic}`, segments };
  }
}

function demoRouteFor(index: number, total: number): StoryboardRoute {
  if (index === 0) return "image_text";
  if (index === total - 1) return "text_image";
  return "image_text_image";
}

function demoFrames(route: StoryboardRoute, title: string, goal: string) {
  const scene = `纯白背景，主角站在讲解台前讲解「${goal}」，日系动漫画风，清晰线条、赛璐璐上色`;
  if (route === "image_text_image") {
    return [
      {
        prompt: `中景。${scene}，主角抬手指向黑板上的要点，表情认真。画面文字：对白气泡『${title}』`,
        altText: `${title}讲解分镜（上）`
      },
      {
        prompt: `近景。${scene}的下一秒，主角伸手比出第一步，眼神发亮。画面文字：旁白框『先看一步』`,
        altText: `${title}讲解分镜（下）`
      }
    ];
  }
  return [
    {
      prompt: `全景。${scene}，主角摊开双手展示完整场景，情绪明快。画面文字：对白气泡『${title}』`,
      altText: `${title}讲解分镜`
    }
  ];
}
