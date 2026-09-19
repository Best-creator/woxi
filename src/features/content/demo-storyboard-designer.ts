import type { StoryboardRoute } from "@/features/articles/domain";
import type {
  GenerateContentInput,
  ReviseStoryboardDesignInput,
  StoryboardDesign,
  StoryboardDesigner,
  StoryboardDesignSegment
} from "./ports";

/**
 * 无 API Key 时的确定性分镜设计器：不访问网络，保证本地开发和 E2E 可重复。
 * 结构与真实设计器一致：逐大纲章节一个分镜段，路由覆盖三种排法
 * （首段 图+文，中段 图+文+图，末段 文+图）。
 * 两种呈现形态各有一套文案：illustrated 沿用旧的讲解式文本；
 * story_comic 走「一段一个梗 + 群体拟人化」的短旁白（每段含标题 ≤60 字、画面里不写字）。
 */
export class DemoStoryboardDesigner implements StoryboardDesigner {
  async design(input: GenerateContentInput): Promise<StoryboardDesign> {
    const storyComic = input.presentation === "story_comic";
    const segments: StoryboardDesignSegment[] = input.outline.map((section, index) => {
      const goal = section.goal?.trim() || section.title;
      const route = demoRouteFor(index, input.outline.length);
      return {
        sectionKey: section.id,
        title: section.title,
        route,
        copy: storyComic
          ? demoStoryComicCopy(index)
          : demoIllustratedCopy(goal, section.title),
        frames: storyComic
          ? demoStoryComicFrames(route, section.title)
          : demoIllustratedFrames(route, section.title, goal)
      };
    });
    // 讲解式的收尾烘在末段；剧情漫画的「一句话记住」本身就是末段的落点，不再追加。
    const last = segments[segments.length - 1];
    if (!storyComic && last && input.brief.oneSentence) {
      last.copy = `${last.copy}\n\n一句话记住：${input.brief.oneSentence}`;
    }
    // 与旧版演示生成器保持一致的成稿标题，方便本地与 E2E 断言。
    return { title: `用大白话讲清楚：${input.topic}`, segments };
  }

  /**
   * 确定性修订：被点名的段（或作者提要求时的全部段）换上「已充实」的文案与修订版帧；
   * 未点名的段逐字保留——编排层靠内容 diff 保住这些段已生成的分镜帧。
   */
  async revise(input: ReviseStoryboardDesignInput): Promise<StoryboardDesign> {
    const storyComic = input.presentation === "story_comic";
    const instructions = input.userInstructions?.trim();
    // 有作者要求时按「全篇都要响应要求」处理，与 demo 大纲修订的语义一致。
    const flagged = new Set(
      instructions
        ? input.currentDesign.segments.map((segment) => segment.sectionKey)
        : input.flaggedSectionKeys
    );
    const sectionsById = new Map(input.outline.map((section) => [section.id, section]));
    const segments: StoryboardDesignSegment[] = input.currentDesign.segments.map((segment, index) => {
      if (!flagged.has(segment.sectionKey)) return segment;
      const section = sectionsById.get(segment.sectionKey);
      const goal = section?.goal?.trim() || segment.title;
      const reason = instructions ? "按你的要求重写" : "按审核意见充实";
      return {
        ...segment,
        copy: storyComic
          ? demoStoryComicCopy(index + 1)
          : `先从一个具体场景说起：${goal}。把这件事放到日常里看，它并不抽象。\n\n` +
            `${reason}之后，这一段补足了场景描绘与细节拆解，解释更具体了。`,
        frames: (storyComic
          ? demoStoryComicFrames(segment.route, segment.title)
          : demoIllustratedFrames(segment.route, segment.title, goal)
        ).map((frame, frameIndex) => ({
          ...frame,
          altText: `${frame.altText}（修订版 ${frameIndex + 1}）`
        }))
      };
    });
    return { title: input.currentDesign.title, segments };
  }
}

function demoRouteFor(index: number, total: number): StoryboardRoute {
  if (index === 0) return "image_text";
  if (index === total - 1) return "text_image";
  return "image_text_image";
}

function demoIllustratedCopy(goal: string, title: string): string {
  // 与真实设计器同一分块口径：copy 用空行分成短块，落库时每块一个段落块。
  return (
    `先从一个具体场景说起：${goal}。把这件事放到日常里看，它并不抽象。\n\n` +
    `说清楚${title}之后，下一步就能自然地接到后面的内容。`
  );
}

function demoIllustratedFrames(route: StoryboardRoute, title: string, goal: string) {
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

/** 一段一个梗的演示节拍：抛梗 → 落点，与真实设计器的两拍结构同构。 */
const DEMO_STORY_BEATS = [
  "一群小家伙围上来，谁都不肯先动手。",
  "带头那只先跳了上去，脚下一滑。",
  "大家七手八脚一起上，场面一度很乱。",
  "个头最小的那只，反倒先找对了门道。"
];

const DEMO_STORY_PUNCHLINES = [
  "道理就这么简单。",
  "看热闹的，往往先看见门道。",
  "乱是乱，办法是这么试出来的。",
  "事情没变，只是换了个看法。"
];

function demoStoryComicCopy(index: number): string {
  const beat = DEMO_STORY_BEATS[index % DEMO_STORY_BEATS.length]!;
  const punchline = DEMO_STORY_PUNCHLINES[index % DEMO_STORY_PUNCHLINES.length]!;
  return `${beat}\n\n${punchline}`;
}

/**
 * 剧情漫画的演示帧：同一物种的复数角色、各自分工，画面里一个字都不写
 * （真实设计器同样被红线禁止让生图模型画字）。
 * 台词在部分帧上带（对白 ≤10 字 / 旁白 ≤25 字，与真实红线同口径）、
 * 部分帧刻意不带——E2E 与组件测试靠它同时覆盖「有台词渲染橙条」
 * 与「旧帧无台词跳过渲染」两条路径。
 */
function demoStoryComicFrames(route: StoryboardRoute, title: string) {
  const cast = "三只圆滚滚的柴犬，短腿、卷尾、都围着同一条蓝色围裙";
  const style = "纯白背景，日系动漫画风，清晰线条、赛璐璐上色";
  if (route === "image_text_image") {
    return [
      {
        prompt: `中景。${cast}，最胖的那只站在木箱上举爪指挥，另外两只合伙推一只大箱子，表情都在使劲。${style}`,
        altText: `${title}剧情分镜（推箱子）`,
        speechLine: { kind: "narration" as const, text: "干活最卖力的，往往是饭量最大的。" }
      },
      {
        prompt: `近景。同一场景的下一秒，箱子翻倒，三只柴犬一起摔在地上，最胖那只强撑体面但眼神已经垮下来。${style}`,
        altText: `${title}剧情分镜（翻了）`,
        speechLine: { kind: "dialogue" as const, text: "说好的轮流呢！" }
      }
    ];
  }
  return [
    {
      prompt: `全景。${cast}，一只蹲在门口发呆，两只挤在门缝边探头探脑，都盯着同一只打翻的食盆。${style}`,
      altText: `${title}剧情分镜`
    }
  ];
}
