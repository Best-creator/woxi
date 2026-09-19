import type { SpeechLine } from "@/features/images/domain";
import type { StoryboardDesign } from "./ports";

/**
 * 剧情漫画（presentation = story_comic）的机械红线，全链路只有这一份口径：
 * 设计提示词要求模型自控、生成闸门（validateStoryboardDesign）越界打回、
 * 审核器（sanitizeContentReview）贴出定位到块的警告——三处说的必须是同一套数。
 *
 * 讲解式（illustrated）不适用这些红线：旧文产物一个字不变。
 */
export const STORY_COMIC_MAX_SEGMENT_CHARS = 60;
export const STORY_COMIC_MAX_SENTENCE_CHARS = 22;
/** 帧台词的红线：对白是角色嘴里的短句，旁白是画外音吐槽。 */
export const STORY_COMIC_MAX_DIALOGUE_CHARS = 10;
export const STORY_COMIC_MAX_NARRATION_CHARS = 25;

/**
 * 与总字数闸同口径的容差：模型偶发小幅超标可接受，成段课文直接打回。
 * 分成「上限」与「判定线」两个常量，是为了让错误信息里报的是人定的 60/22，
 * 而不是被容差放大过的 69/25。
 */
export const STORY_COMIC_TOLERANCE = 1.15;
export const STORY_COMIC_SEGMENT_LIMIT = Math.round(
  STORY_COMIC_MAX_SEGMENT_CHARS * STORY_COMIC_TOLERANCE
);
export const STORY_COMIC_SENTENCE_LIMIT = Math.round(
  STORY_COMIC_MAX_SENTENCE_CHARS * STORY_COMIC_TOLERANCE
);
const DIALOGUE_LIMIT = Math.round(STORY_COMIC_MAX_DIALOGUE_CHARS * STORY_COMIC_TOLERANCE);
const NARRATION_LIMIT = Math.round(STORY_COMIC_MAX_NARRATION_CHARS * STORY_COMIC_TOLERANCE);

/**
 * 「要求生图模型在画面里写字」的字样，含模型惯用的引号。
 * 不能朴素地禁「文字」二字：提示词本身就要求画面不得出现文字，
 * 模型会把这句话抄进每条 prompt——只有「画字」的指令才算违规。
 */
export const DRAW_TEXT_PATTERNS = ["画面文字", "气泡", "旁白框", "字幕", "『", "』"];

/**
 * 解释连接词：教科书推进的指纹，剧情漫画里出现即扣分。
 * 只抓「成对出现」的分点/论证结构——单独一个「最后」「因为」是正常口语叙述
 * （「最后还是最小的先找对了门道」），拿它当违规就是误伤。
 */
const CONNECTIVE_PAIRS: Array<{ words: [string, string]; label: string }> = [
  { words: ["首先", "其次"], label: "「首先…其次…」式的分点推进" },
  { words: ["首先", "最后"], label: "「首先…最后…」式的分点推进" },
  { words: ["因为", "所以"], label: "「因为…所以…」式的论证连接" }
];

/** 书面过渡语：口语叙述里不会这么说话，出现即扣分。 */
const CONNECTIVE_PHRASES = ["由此可见", "综上所述", "总之", "让我们来看看", "值得注意的是"];

/** 并列列举的顿号阈值：一句话里超过 3 个顿号 = 堆列表，读起来就是课本。 */
const LIST_SEPARATOR_LIMIT = 3;

export function charCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 按句末标点切句，用于逐句长度校验；省略号与换行同样算句界。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;…\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function truncate(text: string, max = 20): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 一段（小标题 + 文案 [+ 该段的分镜提示词与台词]）违反剧情漫画红线的所有理由，合规时为空数组。
 * 设计器取第一条抛错（越界即打回重试），审核器逐条贴成警告（定位到该段的小标题块）。
 */
export function inspectStoryComicSegment(input: {
  title: string;
  copy: string;
  prompts?: string[];
  /** 该段分镜帧携带的台词/旁白（剧情漫画烘字红线的一部分）。 */
  speechLines?: SpeechLine[];
}): string[] {
  const complaints: string[] = [];
  const chars = charCount(input.title + input.copy);
  if (chars > STORY_COMIC_SEGMENT_LIMIT) {
    complaints.push(
      `全文 ${chars} 字，超过剧情漫画每段 ${STORY_COMIC_MAX_SEGMENT_CHARS} 字的上限`
    );
  }
  for (const sentence of splitSentences(input.copy)) {
    const length = charCount(sentence);
    if (length > STORY_COMIC_SENTENCE_LIMIT) {
      complaints.push(
        `有 ${length} 字的长句「${truncate(sentence)}」，要求每句话不超过 ${STORY_COMIC_MAX_SENTENCE_CHARS} 字`
      );
    }
  }
  const pair = CONNECTIVE_PAIRS.find(({ words }) => words.every((word) => input.copy.includes(word)));
  if (pair) {
    complaints.push(`出现${pair.label}，剧情漫画要口语推进，不要教科书式连接`);
  }
  const phrase = CONNECTIVE_PHRASES.find((word) => input.copy.includes(word));
  if (phrase) {
    complaints.push(`出现书面过渡语「${phrase}」，换成口语说法`);
  }
  const listed = splitSentences(input.copy).find(
    (sentence) => (sentence.match(/、/g)?.length ?? 0) > LIST_SEPARATOR_LIMIT
  );
  if (listed) {
    complaints.push(`并列列举超过 ${LIST_SEPARATOR_LIMIT} 项（「${truncate(listed)}」），砍到三项以内`);
  }
  for (const prompt of input.prompts ?? []) {
    const hit = DRAW_TEXT_PATTERNS.find((pattern) => prompt.includes(pattern));
    if (hit) {
      complaints.push(`分镜提示词里出现「${hit}」：画面里不得出现任何文字，台词由我们排版`);
    }
  }
  for (const line of input.speechLines ?? []) {
    const isDialogue = line.kind === "dialogue";
    const max = isDialogue ? STORY_COMIC_MAX_DIALOGUE_CHARS : STORY_COMIC_MAX_NARRATION_CHARS;
    const limit = isDialogue ? DIALOGUE_LIMIT : NARRATION_LIMIT;
    const length = charCount(line.text);
    if (length > limit) {
      complaints.push(
        `${isDialogue ? "对白" : "旁白"}「${truncate(line.text)}」有 ${length} 字，要求不超过 ${max} 字`
      );
    }
  }
  return complaints;
}

/** 整份设计的红线检查：逐段跑上面那段，返回段与理由。 */
export function inspectStoryComicDesign(
  design: StoryboardDesign
): Array<{ title: string; complaints: string[] }> {
  return design.segments
    .map((segment) => ({
      title: segment.title,
      complaints: inspectStoryComicSegment({
        title: segment.title,
        copy: segment.copy,
        prompts: segment.frames.map((frame) => frame.prompt),
        speechLines: segment.frames.flatMap((frame) =>
          frame.speechLine ? [frame.speechLine] : []
        )
      })
    }))
    .filter((entry) => entry.complaints.length > 0);
}
