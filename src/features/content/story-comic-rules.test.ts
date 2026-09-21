// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  STORY_COMIC_MAX_SEGMENT_CHARS,
  STORY_COMIC_MAX_SENTENCE_CHARS,
  STORY_COMIC_MIN_DIALOGUE_FRAMES,
  STORY_COMIC_MIN_TEXT_ONLY_SHARE,
  STORY_COMIC_SEGMENT_LIMIT,
  STORY_COMIC_SEGMENTS_PER_DIALOGUE,
  STORY_COMIC_SENTENCE_LIMIT,
  STORY_COMIC_SENTENCE_TOLERANCE,
  STORY_COMIC_TOLERANCE,
  charCount,
  inspectStoryComicDialogueBalance,
  inspectStoryComicDesign,
  inspectStoryComicSegment,
  inspectStoryComicTextOnlyBalance,
  splitSentences,
  storyComicDialogueTarget,
  storyComicTextOnlyTarget
} from "./story-comic-rules";
import type { StoryboardDesign } from "./ports";

/**
 * 这份用例盯的是「三处口径必须一致」的那一份数：阈值、容差、误伤边界。
 * 生成闸门抛什么、审核器贴什么，都由这里的判据决定。
 *
 * 每段字数只算文案（copy）：段名是内部段名，不进正文也不进段图，所以不占这 60 字——
 * 这条口径与 `buildSegmentBlocks` 不产标题块、`stripTextBandsOf` 不烘标题是同一件事。
 */

/** 用「短句 + 句号」拼出恰好 N 个字的文案（避开长句判据，只让段落总长生效）。 */
function copyOfLength(total: number): string {
  const sentences: string[] = [];
  let remaining = total;
  while (remaining > 25) {
    const size = Math.min(25, remaining - 1); // 留出后面那个句号的位置
    sentences.push("狗".repeat(size));
    remaining -= size + 1;
  }
  if (remaining > 0) sentences.push("狗".repeat(remaining));
  return sentences.join("。");
}

describe("charCount / splitSentences", () => {
  it("字数不计空白，含换行与空格", () => {
    expect(charCount("三只柴犬\n排成一队")).toBe(8);
    expect(charCount("  小 狗  ")).toBe(2);
  });

  it("按句末标点与换行切句，省略号也算句界", () => {
    expect(splitSentences("它先看门。然后看窗！真的吗？…算了\n下一句")).toEqual([
      "它先看门",
      "然后看窗",
      "真的吗",
      "算了",
      "下一句"
    ]);
  });

  it("空文案与纯标点不产出句子", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("。。。")).toEqual([]);
  });
});

describe("阈值与容差", () => {
  it("判定线 = 上限 × 容差（段长 60→69，单句 30→40）", () => {
    expect(STORY_COMIC_SEGMENT_LIMIT).toBe(69);
    // 单句的容差故意比别处宽（1.33）：它是风格目标，判定线要落在模型的自然句长带（26-35）之外。
    expect(STORY_COMIC_SENTENCE_LIMIT).toBe(40);
    expect(STORY_COMIC_SEGMENT_LIMIT).toBeGreaterThan(STORY_COMIC_MAX_SEGMENT_CHARS);
    expect(STORY_COMIC_SENTENCE_LIMIT).toBeGreaterThan(STORY_COMIC_MAX_SENTENCE_CHARS);
    expect(STORY_COMIC_SENTENCE_TOLERANCE).toBeGreaterThan(STORY_COMIC_TOLERANCE);
  });

  it("刚好卡在判定线上的段落不算越界", () => {
    const copy = copyOfLength(STORY_COMIC_SEGMENT_LIMIT);
    expect(charCount(copy)).toBe(STORY_COMIC_SEGMENT_LIMIT);
    expect(inspectStoryComicSegment({ copy })).toEqual([]);
  });

  it("判据只算文案：段名不进正文，多长都不占这 60 字", () => {
    const copy = copyOfLength(STORY_COMIC_SEGMENT_LIMIT - 1);
    expect(charCount(copy)).toBe(STORY_COMIC_SEGMENT_LIMIT - 1);
    expect(inspectStoryComicSegment({ copy })).toEqual([]);
  });

  it("越界时报的是人定的 60 而不是放大后的 69", () => {
    const copy = copyOfLength(STORY_COMIC_SEGMENT_LIMIT + 1);
    const complaints = inspectStoryComicSegment({ copy });
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(`${STORY_COMIC_SEGMENT_LIMIT + 1} 字`);
    expect(complaints[0]).toContain(`${STORY_COMIC_MAX_SEGMENT_CHARS} 字的上限`);
    expect(complaints[0]).not.toContain(`${STORY_COMIC_SEGMENT_LIMIT} 字的上限`);
  });

  it("长句单独判：超判定线报错，且错误里报的是人定的上限", () => {
    // 造一句恰好越过判定线的句子（无句末标点，所以整段就是一句）。
    const copy = "狗".repeat(STORY_COMIC_SENTENCE_LIMIT + 1);
    const complaints = inspectStoryComicSegment({ copy });
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(`${STORY_COMIC_MAX_SENTENCE_CHARS} 字`);
  });

  it("刚好卡在判定线上的句子不算越界（30-40 字的容差区）", () => {
    const copy = "狗".repeat(STORY_COMIC_SENTENCE_LIMIT);
    expect(inspectStoryComicSegment({ copy })).toEqual([]);
  });

  it("31-39 字：超过提示词目标但在容差内，不报警告（风格目标是心锚，不是闸门）", () => {
    // 31-34 字正是模型最常写出来的长度。判定线若落在这个带里，每轮都会报掉一半段落，
    // 作者学会无视它——那才是规则真的失效。
    for (const length of [STORY_COMIC_MAX_SENTENCE_CHARS + 1, 34, STORY_COMIC_SENTENCE_LIMIT - 1]) {
      expect(inspectStoryComicSegment({ copy: "狗".repeat(length) })).toEqual([]);
    }
  });
});

describe("连接词：只抓成对，不误伤口语", () => {
  it("单独的「最后」「因为」是正常口语，不报", () => {
    expect(
      inspectStoryComicSegment({
        copy: "最后还是最小的那只先找对了门道"
      })
    ).toEqual([]);
    expect(inspectStoryComicSegment({ copy: "因为它插了队，同伴都回头看它" })).toEqual([]);
  });

  it("成对出现即判：首先…其次 / 首先…最后 / 因为…所以", () => {
    for (const copy of [
      "首先它站到队尾，其次它又跑到了最前",
      "首先它站到队尾，最后它还是插了队",
      "因为它插了队，所以同伴都回头看它"
    ]) {
      const complaints = inspectStoryComicSegment({ copy });
      expect(complaints.join("")).toContain("教科书");
    }
  });

  it("书面过渡语单独出现即判", () => {
    for (const copy of ["由此可见，队伍秩序很关键", "总之，先排队再进门"]) {
      expect(inspectStoryComicSegment({ copy }).join("")).toContain("书面过渡语");
    }
  });
});

describe("列举与画面写字", () => {
  it("一句话里顿号超过 3 个才算堆列表", () => {
    expect(inspectStoryComicSegment({ copy: "带着碗、绳、球、哨子" })).toEqual([]);
    expect(inspectStoryComicSegment({ copy: "带着碗、绳、球、哨子、骨头" }).join("")).toContain(
      "并列列举"
    );
  });

  it("旁白帧与无台词帧：出现「画字」指令才报，普通画面描述不报", () => {
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [{ prompt: "三只柴犬在门口排队，没人看镜头" }]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [{ prompt: "柴犬头顶气泡，气泡里写着一句话" }]
      }).join("")
    ).toContain("画面里不得出现任何文字");
  });

  it("对白帧：台词必须原样写进 prompt，气泡里才画得出这句话", () => {
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [
          {
            prompt: "近景，一只柴犬张嘴喊话，画面文字：对白气泡『插队的出去！』",
            speechLine: { kind: "dialogue", text: "插队的出去！" }
          }
        ]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [
          {
            prompt: "近景，一只柴犬张嘴喊话，头顶画一个空白气泡",
            speechLine: { kind: "dialogue", text: "插队的出去！" }
          }
        ]
      }).join("")
    ).toContain("没有写进分镜提示词");
  });

  it("多个违规一次报全，段内不短路", () => {
    const complaints = inspectStoryComicSegment({
      copy: "首先它站到队尾，其次它带着碗、绳、球、哨子、骨头排了很久很久，久到同伴都困了又都散了。",
      frames: [{ prompt: "画面里出现旁白框" }]
    });
    expect(complaints.length).toBeGreaterThanOrEqual(3);
  });
});

describe("整份设计", () => {
  it("只回有问题的段，段名用于定位", () => {
    const design: StoryboardDesign = {
      title: "插队",
      segments: [
        {
          sectionKey: "queue",
          title: "排队",
          route: "image_text",
          copy: "三只柴犬排成一队",
          frames: [{ prompt: "三只柴犬在门口排队", altText: "三只柴犬在门口排队" }]
        },
        {
          sectionKey: "cutting",
          title: "插队",
          route: "image_text",
          copy: "首先它站到队尾，其次它又跑到了最前。",
          frames: [{ prompt: "一只柴犬挤到队首", altText: "一只柴犬挤到队首" }]
        }
      ]
    };

    const inspected = inspectStoryComicDesign(design);
    expect(inspected.map((entry) => entry.title)).toEqual(["插队"]);
    expect(inspected[0]?.complaints.length).toBeGreaterThan(0);
  });
});

describe("台词/旁白红线", () => {
  it("对白 10 字内合规，超过容差判线打回", () => {
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [{ speechLine: { kind: "dialogue", text: "说好的轮流呢！" } }]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [{ speechLine: { kind: "dialogue", text: "你们排队排得也太慢了吧真急死我了" } }]
      }).join("")
    ).toContain("对白");
  });

  it("旁白 25 字内合规，超长打回并报类型", () => {
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [{ speechLine: { kind: "narration", text: "干活最卖力的往往是饭量最大的那只柴犬。" } }]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        copy: "三只柴犬排成一队",
        frames: [
          { speechLine: { kind: "narration", text: "干活最卖力的往往是饭量最大的那只柴犬，这一点从来没有例外过。" } }
        ]
      }).join("")
    ).toContain("旁白");
  });

  it("整份设计检查会读帧上的 speechLine", () => {
    const design: StoryboardDesign = {
      title: "插队",
      segments: [
        {
          sectionKey: "cutting",
          title: "插队",
          route: "image_text",
          copy: "三只柴犬排成一队",
          frames: [
            {
              prompt: "一只柴犬挤到队首",
              altText: "一只柴犬挤到队首",
              speechLine: { kind: "dialogue", text: "你们排队排得太慢了吧真急死我了" }
            }
          ]
        }
      ]
    };

    const inspected = inspectStoryComicDesign(design);
    expect(inspected).toHaveLength(1);
    expect(inspected[0]?.complaints.join("")).toContain("对白");
  });
});

describe("全篇对白密度", () => {
  it("目标 = 段数÷5 向下取整，最少 2 个（单个孤立对白正是要禁止的）", () => {
    expect(STORY_COMIC_SEGMENTS_PER_DIALOGUE).toBe(5);
    expect(STORY_COMIC_MIN_DIALOGUE_FRAMES).toBe(2);
    expect(storyComicDialogueTarget(3)).toBe(2);
    expect(storyComicDialogueTarget(10)).toBe(2);
    expect(storyComicDialogueTarget(11)).toBe(2);
    expect(storyComicDialogueTarget(15)).toBe(3);
    expect(storyComicDialogueTarget(22)).toBe(4);
  });

  it("对白帧不足时报全篇理由，写明一来一往的口径", () => {
    const complaints = inspectStoryComicDialogueBalance({ segmentCount: 21, dialogueFrameCount: 0 });
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain("至少要 4 个");
    expect(complaints[0]).toContain("一来一往");
    expect(complaints[0]).toContain("孤立气泡");
  });

  it("达标与超额都合规", () => {
    expect(
      inspectStoryComicDialogueBalance({ segmentCount: 21, dialogueFrameCount: 4 })
    ).toEqual([]);
    expect(
      inspectStoryComicDialogueBalance({ segmentCount: 21, dialogueFrameCount: 9 })
    ).toEqual([]);
  });
});

describe("全篇纯文字配比", () => {
  it("目标 = 段数 × 30% 向上取整（3 段至少 1 段，10 段至少 3 段）", () => {
    expect(STORY_COMIC_MIN_TEXT_ONLY_SHARE).toBe(0.3);
    expect(storyComicTextOnlyTarget(3)).toBe(1);
    expect(storyComicTextOnlyTarget(4)).toBe(2);
    expect(storyComicTextOnlyTarget(10)).toBe(3);
    expect(storyComicTextOnlyTarget(11)).toBe(4);
  });

  it("配比不足时报全篇理由，写明纯文字段承接节奏的口径", () => {
    const complaints = inspectStoryComicTextOnlyBalance({ segmentCount: 10, textOnlyCount: 2 });
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain("至少要 3 段");
    expect(complaints[0]).toContain("text_only");
  });

  it("压线与超额都合规", () => {
    expect(inspectStoryComicTextOnlyBalance({ segmentCount: 3, textOnlyCount: 1 })).toEqual([]);
    expect(inspectStoryComicTextOnlyBalance({ segmentCount: 10, textOnlyCount: 5 })).toEqual([]);
  });
});
