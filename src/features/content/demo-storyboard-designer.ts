import type { StoryboardRoute } from "@/features/articles/domain";
import { DEFAULT_DRAWING_STYLE } from "@/features/images/style-text";
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
      const route = demoRouteFor(index, input.outline.length, storyComic);
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

/**
 * 演示路由分配。讲解式维持旧三样（首段 图+文，中段 图+文+图，末段 文+图）；
 * 剧情漫画从 2026-09-21 起带第四种路由 text_only（纯文字段，0 帧）：
 * 每三段一段纯文字 + 末段固定纯文字，保证「纯文字占比 ≥30%」的红线压线达标
 * （3 章 demo = 1/3）；同时 3 段里仍有 2 个对白帧（首段单帧 + 中段 iti 落点），
 * 满足对白密度 ≥ 段数÷5 且最少 2 个的红线。
 */
function demoRouteFor(index: number, total: number, storyComic: boolean): StoryboardRoute {
  if (index === 0) return "image_text";
  if (!storyComic) {
    if (index === total - 1) return "text_image";
    return "image_text_image";
  }
  if (index === total - 1 || (index + 1) % 3 === 0) return "text_only";
  return index % 2 === 1 ? "image_text_image" : "text_image";
}

function demoIllustratedCopy(goal: string, title: string): string {
  // 与真实设计器同一分块口径：copy 用空行分成短块，落库时每块一个段落块。
  return (
    `先从一个具体场景说起：${goal}。把这件事放到日常里看，它并不抽象。\n\n` +
    `说清楚${title}之后，下一步就能自然地接到后面的内容。`
  );
}

function demoIllustratedFrames(route: StoryboardRoute, title: string, goal: string) {
  // 纯文字段没有画面；正常流程不会给讲解式 demo 分到 text_only，兜底只为类型周全。
  if (route === "text_only") return [];
  const scene = `纯白背景，主角站在讲解台前讲解「${goal}」，${DEFAULT_DRAWING_STYLE}`;
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
 * 剧情漫画的演示帧：同一物种的复数角色、各自分工。文字红线与真实设计器同口径——
 * 旁白帧与无台词帧的画面里一个字都不写；**对白帧画进气泡**，prompt 末尾按
 * 「画面文字：对白气泡『台词』」带上台词原句（红线会查台词是否写进 prompt）。
 * 对白密度红线（全篇 ≥ 段数÷5 且最少 2 个）同样要满足：3 章 demo 的路由是
 * [image_text, image_text_image, text_only]——首段单帧 + 中段 iti 落点帧各带一句
 * dialogue，恰好 2 个达标；纯文字段没有帧，天然不参与对白与画面红线。
 * E2E 与组件测试靠首段「单帧无旁白条 + 对白气泡」、中段「旁白橙条 + 对白气泡」
 * 同时覆盖「旁白渲染橙条」「对白只在气泡里」「旧帧无台词跳过渲染」三条路径。
 */
function demoStoryComicFrames(route: StoryboardRoute, title: string) {
  if (route === "text_only") return [];
  const cast = "三只圆滚滚的柴犬，短腿、卷尾、都围着同一条蓝色围裙";
  const style = `纯白背景，${DEFAULT_DRAWING_STYLE}`;
  if (route === "image_text_image") {
    return [
      {
        prompt: `中景。${cast}，最胖的那只站在木箱上举爪指挥，另外两只合伙推一只大箱子，表情都在使劲。${style}`,
        altText: `${title}剧情分镜（推箱子）`,
        speechLine: { kind: "narration" as const, text: "干活最卖力的，往往是饭量最大的。" }
      },
      {
        prompt: `近景。同一场景的下一秒，箱子翻倒，三只柴犬一起摔在地上，最胖那只强撑体面但眼神已经垮下来，旁边一只捂嘴憋笑看它。${style}。画面文字：对白气泡『说好的轮流呢！』`,
        altText: `${title}剧情分镜（翻了）`,
        speechLine: { kind: "dialogue" as const, text: "说好的轮流呢！" }
      }
    ];
  }
  return [
    {
      prompt: `全景。${cast}，一只蹲在门口发呆，另外两只挤在门缝边探头探脑互相对吼，都盯着同一只打翻的食盆。${style}。画面文字：对白气泡『先吃的是赢家！』`,
      altText: `${title}剧情分镜`,
      speechLine: { kind: "dialogue" as const, text: "先吃的是赢家！" }
    }
  ];
}
