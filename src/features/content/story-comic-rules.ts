import type { SpeechLine } from "@/features/images/domain";
import type { StoryboardDesign } from "./ports";

/**
 * 剧情漫画（presentation = story_comic）的机械红线，全链路只有这一份口径：
 * 设计提示词要求模型自控、审核器（openai-content-reviewer 的 storyComicRedlineIssues）
 * 逐条贴成定位到段的警告并把关提交——两处说的必须是同一套数。
 *
 * 生成/修订阶段**不再**用这份红线打回：设计稿要先落库成版本，作者才有东西可改可退。
 * 「改到什么程度才算合规」是审核的职责，不是生成的前置条件。
 *
 * 讲解式（illustrated）不适用这些红线：旧文产物一个字不变。
 */
export const STORY_COMIC_MAX_SEGMENT_CHARS = 60;
/**
 * 单句的**风格目标**。取 30 是折中，不是拍脑袋：
 * - 段图正文每行最多 13 个全角字（images/comic-strip 的 TEXT_BAND_MAX_CHARS_PER_LINE），
 *   30 字 ≈ 2.3 行——读者一眼扫完不用回看开头；
 * - 原来的 22 字（≈1.7 行）落在模型的**自然句长之下**：三轮真跑里 16/21、9/21、0/22 段踩线，
 *   越界句集中在 26-42 字，规则成了噪声而不是约束；
 * - 但目标也不能放到 40：提示词里的数字是模型的锚点，写 40 不是「允许写到 40」而是「请写到 40」，
 *   模型会稳定产出 35-45 字的句子——那正是讲解式的块长（30-60 字），两种形态的区别就没了。
 *
 * 它只是**目标**：真正的报警线是 STORY_COMIC_SENTENCE_LIMIT（40 字），见下。
 */
export const STORY_COMIC_MAX_SENTENCE_CHARS = 30;
/** 帧台词的红线：对白是角色嘴里的短句，旁白是画外音吐槽。 */
export const STORY_COMIC_MAX_DIALOGUE_CHARS = 10;
export const STORY_COMIC_MAX_NARRATION_CHARS = 25;

/**
 * 段数反推的除数：剧情漫画一段只演一个节拍、文案 ≤60 字，所以「推荐字数 ÷ 55」
 * 就是该写多少段（取 55 而不是 60，是给段末收束句留出余量）。
 *
 * 这是全链路唯一一份「一段配多少字」的数：设计提示词的段数公式、
 * 结构闸的上限（schemas 的 MAX_STORYBOARD_SEGMENTS）都从它推。
 * 2026-09-20 真实模型验收栽过一次——提示词按 1000 字要 18 段，而 segments 数组
 * 上限还停在讲解式的 16，模型一产出就被 schema 打回，看着像模型写错，
 * 其实是两处各写一份数、互相打架。
 */
export const STORY_COMIC_WORDS_PER_SEGMENT = 55;

/** 段数允许的浮动幅度（±2 段）：章节点多寡不同，不必强求整除。 */
export const STORY_COMIC_SEGMENT_TOLERANCE = 2;

/** 给定推荐总字数，剧情漫画该写多少段（段数反推的唯一入口）。 */
export function storyComicSegmentTarget(recommendedTotalWords: number): number {
  return Math.max(1, Math.round(recommendedTotalWords / STORY_COMIC_WORDS_PER_SEGMENT));
}

/**
 * 角色对白的密度下限：**每 5 段至少 1 个对白帧，全篇最少 2 个**。
 * 2026-09-20 真机验收发现：提示词只把 dialogue 写成「可选、宁缺毋滥」，模型就一篇对白都不写
 * （17 段全旁白独角戏）——没有数量下限的「鼓励」等于没有。而「最少 2 个」是因为
 * 单个孤立对白正是要禁止的东西：一个角色对着空气说一句，既没有对话对象也没有笑点。
 */
export const STORY_COMIC_SEGMENTS_PER_DIALOGUE = 5;
export const STORY_COMIC_MIN_DIALOGUE_FRAMES = 2;

/** 给定段数，全篇该配几个对白帧（对白密度下限的唯一入口）。 */
export function storyComicDialogueTarget(segmentCount: number): number {
  return Math.max(
    STORY_COMIC_MIN_DIALOGUE_FRAMES,
    Math.floor(segmentCount / STORY_COMIC_SEGMENTS_PER_DIALOGUE)
  );
}

/**
 * 与总字数预算同口径的容差：模型偶发小幅超标可接受，成段课文才算越界。
 * 分成「上限」与「判定线」两个常量，是为了让问题描述里报的是人定的 60/30，
 * 而不是被容差放大过的 69/40。
 */
export const STORY_COMIC_TOLERANCE = 1.15;
export const STORY_COMIC_SEGMENT_LIMIT = Math.round(
  STORY_COMIC_MAX_SEGMENT_CHARS * STORY_COMIC_TOLERANCE
);

/**
 * 单句的容差比别的红线宽得多（1.33 → 判定线 40 字），因为这一条的性质不同：
 * 段长、台词长度是**可执行的硬约束**（模型数得准），单句长度只是一个**风格目标**——
 * 实测模型的自然句长就落在 26-35 字（含 31-34 这一大批），判定线只要落在这个带里
 * 就会「每轮都报一半段落」，作者于是学会无视它，那才是真的失效。
 *
 * 40 字 ≈ 3 行：**只有明显写成整段课文的长句才报**，31-39 字一律放行。
 * 目标仍然写在提示词里（30 字），模型照旧朝短句写——目标是心锚，判定线才是闸门。
 */
export const STORY_COMIC_SENTENCE_TOLERANCE = 1.33;
export const STORY_COMIC_SENTENCE_LIMIT = Math.round(
  STORY_COMIC_MAX_SENTENCE_CHARS * STORY_COMIC_SENTENCE_TOLERANCE
);
const DIALOGUE_LIMIT = Math.round(STORY_COMIC_MAX_DIALOGUE_CHARS * STORY_COMIC_TOLERANCE);
const NARRATION_LIMIT = Math.round(STORY_COMIC_MAX_NARRATION_CHARS * STORY_COMIC_TOLERANCE);

/**
 * 「要求生图模型在画面里写字」的字样，含模型惯用的引号。
 * 不能朴素地禁「文字」二字：提示词本身就要求画面不得出现文字，
 * 模型会把这句话抄进每条 prompt——只有「画字」的指令才算违规。
 *
 * ⚠️ 这组模式只用于**旁白帧与无台词帧**（对白帧走另一条路：查台词是否原样写进 prompt，
 * 在下面的分支里提前 continue，不会落到这里）——因为从 2026-09-20 起对白画进图内气泡，
 * 对白帧的 prompt 里合法地出现「气泡」与「画面文字」字样；旁白帧与无台词帧则一个都不许有。
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
 * 一段（文案 [+ 该段的分镜帧]）违反剧情漫画红线的所有理由，合规时为空数组。
 * 每段字数按**读者实际读到的字数**算，也就是只算 copy：段名是内部段名，
 * 既不进正文也不进段图，所以不占每段 60 字的预算（讲解式才有小标题进正文的事）。
 * 审核器逐条贴成警告（定位到该段），并据此把「内容没问题」降级成「需要修订」。
 *
 * 帧按「prompt + 台词」成对核对，两条路：
 * - **对白帧**（speechLine.kind = dialogue）：台词要画进这一格的气泡里，所以
 *   prompt 必须原样带上这句台词——没带，气泡里就画不出读者该读到的那句话；
 * - **旁白帧 / 无台词帧**：画面里一个字都不许出现（旁白由排版层挂在图外），
 *   prompt 里出现任何「画字」指令都算违规。
 */
export function inspectStoryComicSegment(input: {
  copy: string;
  /** 该段的分镜帧，prompt 与台词成对（与 ReviewableStoryboardFrame / 设计稿的帧同构）。 */
  frames?: Array<{ prompt?: string; speechLine?: SpeechLine | null }>;
}): string[] {
  const complaints: string[] = [];
  const chars = charCount(input.copy);
  if (chars > STORY_COMIC_SEGMENT_LIMIT) {
    complaints.push(
      `本段 ${chars} 字，超过剧情漫画每段 ${STORY_COMIC_MAX_SEGMENT_CHARS} 字的上限`
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
  for (const frame of input.frames ?? []) {
    const prompt = frame.prompt ?? "";
    const line = frame.speechLine ?? null;
    if (line?.kind === "dialogue") {
      const length = charCount(line.text);
      if (length > DIALOGUE_LIMIT) {
        complaints.push(
          `对白「${truncate(line.text)}」有 ${length} 字，要求不超过 ${STORY_COMIC_MAX_DIALOGUE_CHARS} 字`
        );
      }
      // 气泡里画的就是这句台词，所以它必须原样出现在 prompt 里。
      if (prompt && !prompt.includes(line.text)) {
        complaints.push(
          `对白「${truncate(line.text)}」没有写进分镜提示词，气泡里画不出这句台词`
        );
      }
      continue;
    }
    for (const pattern of DRAW_TEXT_PATTERNS) {
      if (prompt.includes(pattern)) {
        complaints.push(
          `分镜提示词里出现「${pattern}」：${
            line?.kind === "narration"
              ? "旁白由我们排在图外"
              : "画面里不得出现任何文字，台词由我们排版"
          }`
        );
      }
    }
    if (line) {
      const length = charCount(line.text);
      if (length > NARRATION_LIMIT) {
        complaints.push(
          `旁白「${truncate(line.text)}」有 ${length} 字，要求不超过 ${STORY_COMIC_MAX_NARRATION_CHARS} 字`
        );
      }
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
        copy: segment.copy,
        frames: segment.frames.map((frame) => ({
          prompt: frame.prompt,
          speechLine: frame.speechLine ?? null
        }))
      })
    }))
    .filter((entry) => entry.complaints.length > 0);
}

/**
 * 全篇对白密度体检：对白帧数低于下限时返回一条全篇理由（合规时为空数组）。
 * 这是**全篇级**问题（该在哪几段补对白由模型按剧情定），所以不定位到段，
 * 与「全篇字数超预算」一样由审核器贴成不可定位的警告。
 *
 * 只对带分镜的输入有意义：老快照的退化路径里帧信息全空，判不了也不该判。
 */
export function inspectStoryComicDialogueBalance(input: {
  segmentCount: number;
  dialogueFrameCount: number;
}): string[] {
  const target = storyComicDialogueTarget(input.segmentCount);
  if (input.dialogueFrameCount >= target) return [];
  return [
    `全篇只有 ${input.dialogueFrameCount} 个对白帧，按 ${input.segmentCount} 段至少要 ${target} 个：` +
      "对白是角色之间一来一往的对话（你一句我一句），不是可选装饰——禁止全篇旁白独角戏，也禁止只剩一个孤立气泡没人接话"
  ];
}

/**
 * 纯文字段（route = text_only，0 帧、不拼段图，文案以普通正文段落发布）的占比下限：
 * **每 10 段至少 3 段是纯文字（30%，向上取整）**。2026-09-21 用户拍板：
 * 漫画段负责把梗演出来，纯文字段负责承接、转折与点睛——全是画面会累，全是文字会闷。
 *
 * 判定线取 ceil 而不是 floor：「不低于 30%」的数学含义就是 count ≥ 30% × 段数，
 * floor 会让 4 段文章只要求 1 段（25%）就合规。demo 的 3 段恰好 1 段纯文字，压线达标。
 */
export const STORY_COMIC_MIN_TEXT_ONLY_SHARE = 0.3;

/** 给定段数，全篇至少该有几段纯文字（纯文字占比下限的唯一入口）。 */
export function storyComicTextOnlyTarget(segmentCount: number): number {
  return Math.ceil(segmentCount * STORY_COMIC_MIN_TEXT_ONLY_SHARE);
}

/**
 * 全篇纯文字占比体检：text_only 段数低于下限时返回一条全篇理由（合规时为空数组）。
 * 与对白密度同款约定：全篇级问题、不定位到段、只对带分镜段（有 route 信息）的输入判。
 */
export function inspectStoryComicTextOnlyBalance(input: {
  segmentCount: number;
  textOnlyCount: number;
}): string[] {
  const target = storyComicTextOnlyTarget(input.segmentCount);
  if (input.textOnlyCount >= target) return [];
  return [
    `全篇 ${input.segmentCount} 段里只有 ${input.textOnlyCount} 段是纯文字段，至少要 ${target} 段：` +
      "漫画段负责把梗演出来，纯文字段负责承接与点睛——把不需要画面的段改成「纯文字」排法（text_only），图文交替才有节奏"
  ];
}
