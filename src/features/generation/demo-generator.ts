import { createHash } from "node:crypto";
import type { ContentBlock, OutlineSection } from "@/features/articles/domain";
import type {
  ContentGenerator,
  GeneratedArticleContent,
  GeneratedFoundation,
  GenerateArticleContentInput,
  LegacyContentGenerator
} from "./content-generator";

function stableId(topic: string, kind: string, order: number) {
  const hex = createHash("sha256")
    .update(`${topic}:${kind}:${order}`)
    .digest("hex")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function outline(topic: string): OutlineSection[] {
  return ["先说结论", "它为什么重要", "用一个例子理解", "最后总结"].map(
    (title, order) => ({
      id: stableId(topic, "outline", order),
      title,
      order
    })
  );
}

function block(
  topic: string,
  order: number,
  type: ContentBlock["type"],
  content: string,
  level?: 1 | 2 | 3
): ContentBlock {
  return {
    id: stableId(topic, "block", order),
    type,
    content,
    order,
    version: 1,
    ...(level ? { level } : {})
  };
}

export class DemoContentGenerator implements ContentGenerator, LegacyContentGenerator {
  async generate(input: GenerateArticleContentInput): Promise<GeneratedArticleContent> {
    const title = `用大白话讲清楚：${input.topic}`;
    const blocks: ContentBlock[] = [
      block(input.topic, 0, "heading", title, 1)
    ];

    for (const section of input.outline) {
      const order = blocks.length;
      blocks.push(
        block(input.topic, order, "heading", section.title, 2),
        block(
          input.topic,
          order + 1,
          "paragraph",
          `${section.goal ?? section.title}。${input.brief.oneSentence}`
        )
      );
    }

    if (input.sourceContext) {
      blocks.push(
        block(
          input.topic,
          blocks.length,
          "callout",
          `已参考资料摘录：${input.sourceContext.replace(/\s+/g, " ").trim().slice(0, 120)}`
        )
      );
    }
    return { title, blocks };
  }

  async generateFoundation(input: { topic: string; sourceContext?: string }): Promise<GeneratedFoundation> {
    const { topic, sourceContext } = input;
    const sourceNote = sourceContext
      ? `已读取资料摘录：${sourceContext.replace(/\s+/g, " ").trim().slice(0, 120)}`
      : null;
    return {
      title: `用大白话讲清楚：${topic}`,
      brief: {
        oneSentence: `${topic}可以从“它是什么、为什么重要、如何影响日常选择”三个角度理解。`,
        concepts: ["核心定义", "形成机制", "实际影响"],
        prerequisites: ["不需要专业背景，从生活经验出发即可理解。"],
        misconceptions: ["常见误区是只记住结论，却忽略结论成立的条件。"],
        analogies: ["把它想成一张路线图：先找当前位置，再看不同选择通向哪里。"],
        unsupportedNotes: [
          "演示内容尚未连接外部资料，请发布前核对事实。",
          ...(sourceNote ? [sourceNote] : [])
        ]
      },
      outline: outline(topic),
      blocks: [
        block(topic, 0, "heading", `用大白话讲清楚：${topic}`, 1),
        block(
          topic,
          1,
          "paragraph",
          `很多人第一次接触“${topic}”时，会觉得它离生活很远。其实，把术语拿掉以后，它通常描述的是一种我们每天都会遇到的现象。`
        ),
        block(topic, 2, "heading", "先说结论", 2),
        block(
          topic,
          3,
          "paragraph",
          `${topic}最值得理解的，不只是一个定义，而是它背后的因果关系。先知道发生了什么，再追问为什么发生，理解就会稳固很多。`
        ),
        block(
          topic,
          4,
          "knowledge_card",
          `核心关系\n现象：${topic}\n方法：拆开条件、过程和结果\n目标：把抽象概念放回真实场景`
        ),
        block(topic, 5, "heading", "用一个例子理解", 2),
        block(
          topic,
          6,
          "paragraph",
          "假设你正在向一位完全不了解这个概念的朋友解释。先给出他熟悉的场景，再指出场景里的关键变化，最后补上概念名称，比一开始背定义更容易理解。"
        ),
        block(
          topic,
          7,
          "quote",
          "真正理解一个知识点，是能用自己的话解释它，也能说清它不适用于什么情况。"
        ),
        block(topic, 8, "heading", "最后总结", 2),
        block(
          topic,
          9,
          "callout",
          `记住三个问题：${topic}是什么？为什么会发生？它会怎样影响实际选择？`
        )
      ]
    };
  }
}
