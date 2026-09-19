// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  STORY_COMIC_MAX_SEGMENT_CHARS,
  STORY_COMIC_MAX_SENTENCE_CHARS,
  STORY_COMIC_SEGMENT_LIMIT,
  STORY_COMIC_SENTENCE_LIMIT,
  charCount,
  inspectStoryComicDesign,
  inspectStoryComicSegment,
  splitSentences
} from "./story-comic-rules";
import type { StoryboardDesign } from "./ports";

/**
 * 这份用例盯的是「三处口径必须一致」的那一份数：阈值、容差、误伤边界。
 * 生成闸门抛什么、审核器贴什么，都由这里的判据决定。
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
  it("判定线 = 上限 × 容差（60→69，22→25）", () => {
    expect(STORY_COMIC_SEGMENT_LIMIT).toBe(69);
    expect(STORY_COMIC_SENTENCE_LIMIT).toBe(25);
    expect(STORY_COMIC_SEGMENT_LIMIT).toBeGreaterThan(STORY_COMIC_MAX_SEGMENT_CHARS);
    expect(STORY_COMIC_SENTENCE_LIMIT).toBeGreaterThan(STORY_COMIC_MAX_SENTENCE_CHARS);
  });

  it("刚好卡在判定线上的段落不算越界", () => {
    const copy = copyOfLength(STORY_COMIC_SEGMENT_LIMIT);
    expect(charCount(copy)).toBe(STORY_COMIC_SEGMENT_LIMIT);
    expect(inspectStoryComicSegment({ title: "", copy })).toEqual([]);
  });

  it("判据用「标题 + 文案」合计，且报的是人定的 60 而不是放大后的 69", () => {
    const copy = copyOfLength(STORY_COMIC_SEGMENT_LIMIT - 1);
    const complaints = inspectStoryComicSegment({ title: "排队", copy });
    expect(complaints).toHaveLength(1);
    // 合计 68 + 2 = 70 字；错误信息里报人定的 60，不报被容差放大过的 69。
    expect(complaints[0]).toContain("70 字");
    expect(complaints[0]).toContain(`${STORY_COMIC_MAX_SEGMENT_CHARS} 字的上限`);
    expect(complaints[0]).not.toContain(`${STORY_COMIC_SEGMENT_LIMIT} 字的上限`);
  });

  it("长句单独判：超 25 字报错，且错误里报的是 22", () => {
    const complaints = inspectStoryComicSegment({
      title: "排队",
      copy: "它们排成一队等着进门，谁也没有插队的意思，秩序好得让人意外。"
    });
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(`${STORY_COMIC_MAX_SENTENCE_CHARS} 字`);
  });
});

describe("连接词：只抓成对，不误伤口语", () => {
  it("单独的「最后」「因为」是正常口语，不报", () => {
    expect(
      inspectStoryComicSegment({
        title: "找门",
        copy: "最后还是最小的那只先找对了门道"
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({ title: "插队", copy: "因为它插了队，同伴都回头看它" })
    ).toEqual([]);
  });

  it("成对出现即判：首先…其次 / 首先…最后 / 因为…所以", () => {
    for (const copy of [
      "首先它站到队尾，其次它又跑到了最前",
      "首先它站到队尾，最后它还是插了队",
      "因为它插了队，所以同伴都回头看它"
    ]) {
      const complaints = inspectStoryComicSegment({ title: "插队", copy });
      expect(complaints.join("")).toContain("教科书");
    }
  });

  it("书面过渡语单独出现即判", () => {
    for (const copy of ["由此可见，队伍秩序很关键", "总之，先排队再进门"]) {
      expect(inspectStoryComicSegment({ title: "结论", copy }).join("")).toContain("书面过渡语");
    }
  });
});

describe("列举与画面写字", () => {
  it("一句话里顿号超过 3 个才算堆列表", () => {
    expect(inspectStoryComicSegment({ title: "道具", copy: "带着碗、绳、球、哨子" })).toEqual([]);
    expect(
      inspectStoryComicSegment({ title: "道具", copy: "带着碗、绳、球、哨子、骨头" }).join("")
    ).toContain("并列列举");
  });

  it("分镜提示词里出现「画字」指令才报，普通画面描述不报", () => {
    expect(
      inspectStoryComicSegment({
        title: "排队",
        copy: "三只柴犬排成一队",
        prompts: ["三只柴犬在门口排队，没人看镜头"]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        title: "排队",
        copy: "三只柴犬排成一队",
        prompts: ["柴犬头顶气泡，气泡里写着一句话"]
      }).join("")
    ).toContain("画面里不得出现任何文字");
  });

  it("多个违规一次报全，段内不短路", () => {
    const complaints = inspectStoryComicSegment({
      title: "排队",
      copy: "首先它站到队尾，其次它带着碗、绳、球、哨子、骨头排了很久很久，久到同伴都困了。",
      prompts: ["画面里出现旁白框"]
    });
    expect(complaints.length).toBeGreaterThanOrEqual(3);
  });
});

describe("整份设计", () => {
  it("只回有问题的段，标题用于定位", () => {
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
        title: "排队",
        copy: "三只柴犬排成一队",
        speechLines: [{ kind: "dialogue", text: "说好的轮流呢！" }]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        title: "排队",
        copy: "三只柴犬排成一队",
        speechLines: [{ kind: "dialogue", text: "你们排队排得也太慢了吧真急死我了" }]
      }).join("")
    ).toContain("对白");
  });

  it("旁白 25 字内合规，超长打回并报类型", () => {
    expect(
      inspectStoryComicSegment({
        title: "排队",
        copy: "三只柴犬排成一队",
        speechLines: [{ kind: "narration", text: "干活最卖力的往往是饭量最大的那只柴犬。" }]
      })
    ).toEqual([]);
    expect(
      inspectStoryComicSegment({
        title: "排队",
        copy: "三只柴犬排成一队",
        speechLines: [
          { kind: "narration", text: "干活最卖力的往往是饭量最大的那只柴犬，这一点从来没有例外过。" }
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
              speechLine: { kind: "dialogue", text: "你们排队排得也太慢了吧真急死我了" }
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
