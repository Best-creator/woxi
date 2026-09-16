import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/features/articles/domain";
import type { ImageAsset } from "./domain";
import {
  MIN_COMIC_STRIP_PANELS,
  inspectComicStrip,
  layoutComicStrip,
  planComicStrips
} from "./plan-comic-strip";

function heading(id: string, content: string, order: number): ContentBlock {
  return { id, type: "heading", content, order, level: 2, version: 1 };
}

function paragraph(id: string, content: string, order: number): ContentBlock {
  return { id, type: "paragraph", content, order, version: 1 };
}

function knowledgeCard(id: string, content: string, order: number): ContentBlock {
  return { id, type: "knowledge_card", content, order, version: 1 };
}

function asset(id: string, anchorBlockId: string, overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    articleId: "article-1",
    anchorBlockId,
    type: "storyboard",
    purpose: `分镜 ${id}`,
    prompt: "prompt",
    altText: `分镜 ${id}`,
    aspectRatio: "square",
    status: "generated",
    placeholderUrl: `api/${id}`,
    filePath: `.data/${id}.png`,
    publicUrl: null,
    manuallyEdited: false,
    consumedContent: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides
  };
}

/** 三格漫画：每格都是「分镜标题 + 一句文案」，各挂一张图。 */
function threePanelComic() {
  const blocks = [
    heading("h1", "第一格：眼睛为什么会酸", 0),
    paragraph("p1", "盯着屏幕时眨眼次数掉了一半。", 1),
    heading("h2", "第二格：眨眼少了会怎样", 2),
    paragraph("p2", "泪膜撑不住，眼睛就开始报警。", 3),
    heading("h3", "第三格：怎么救", 4),
    paragraph("p3", "二十分钟看远处二十秒。", 5)
  ];
  const assets = [asset("a1", "p1"), asset("a2", "p2"), asset("a3", "p3")];
  return { blocks, assets };
}

function threePanelGroup() {
  const { blocks, assets } = threePanelComic();
  const [group] = planComicStrips(blocks, assets);
  if (!group) throw new Error("fixture should produce one group");
  return group;
}

describe("planComicStrips", () => {
  it("collects consecutive panels into one group and takes the heading as the panel title", () => {
    const { blocks, assets } = threePanelComic();
    const groups = planComicStrips(blocks, assets);

    expect(groups).toHaveLength(1);
    expect(groups[0].panels.map((panel) => panel.title)).toEqual([
      "第一格：眼睛为什么会酸",
      "第二格：眨眼少了会怎样",
      "第三格：怎么救"
    ]);
    expect(groups[0].panels.map((panel) => panel.caption)).toEqual([
      "盯着屏幕时眨眼次数掉了一半。",
      "泪膜撑不住，眼睛就开始报警。",
      "二十分钟看远处二十秒。"
    ]);
  });

  it("records exactly the blocks the strip replaces, anchored at the first one", () => {
    const { blocks, assets } = threePanelComic();
    const [group] = planComicStrips(blocks, assets);

    expect(group.anchorBlockId).toBe("h1");
    expect(group.consumedContent.blocks.map((block) => block.id)).toEqual([
      "h1",
      "p1",
      "h2",
      "p2",
      "h3",
      "p3"
    ]);
    // 排到正文末尾，取消长图时原文追加回结尾。
    expect(group.consumedContent.resumeBeforeBlockId).toBeNull();
  });

  it("keeps the closing knowledge card out of the strip so it stays real text", () => {
    const { blocks, assets } = threePanelComic();
    const withCard = [...blocks, knowledgeCard("card", "护眼清单\n20-20-20", 6)];
    const [group] = planComicStrips(withCard, assets);

    expect(group.consumedContent.blocks.map((block) => block.id)).not.toContain("card");
  });

  it("breaks the comic where a section has no image, and remembers where to put the text back", () => {
    const blocks = [
      heading("h1", "第一格", 0),
      paragraph("p1", "文案一", 1),
      heading("h2", "第二格", 2),
      paragraph("p2", "文案二", 3),
      heading("h3", "写在最后", 4),
      paragraph("p3", "这一段是正经正文，不该卷进漫画。", 5)
    ];
    const groups = planComicStrips(blocks, [asset("a1", "p1"), asset("a2", "p2")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].panels).toHaveLength(2);
    expect(groups[0].consumedContent.blocks.map((block) => block.id)).toEqual(["h1", "p1", "h2", "p2"]);
    // 原文要插回「写在最后」这一块之前，而不是无脑追加到结尾。
    expect(groups[0].consumedContent.resumeBeforeBlockId).toBe("h3");
  });

  it("leaves a lead paragraph without a heading alone", () => {
    const blocks = [
      paragraph("lead", "先说个题外话。", 0),
      heading("h1", "第一格", 1),
      paragraph("p1", "文案一", 2),
      heading("h2", "第二格", 3),
      paragraph("p2", "文案二", 4)
    ];
    const [group] = planComicStrips(blocks, [asset("a1", "p1"), asset("a2", "p2")]);

    expect(group.consumedContent.blocks.map((block) => block.id)).not.toContain("lead");
  });

  it("ignores covers, disabled assets, cards already stripped, and the strip itself", () => {
    const { blocks } = threePanelComic();
    const groups = planComicStrips(blocks, [
      asset("cover", "p1", { type: "cover", anchorBlockId: null }),
      asset("disabled", "p1", { status: "disabled" }),
      asset("strip", "p1", {
        type: "comic_strip",
        consumedContent: { blocks: [], resumeBeforeBlockId: null }
      })
    ]);

    expect(groups).toEqual([]);
  });

  it("finds nothing when no image is anchored to the text", () => {
    const { blocks } = threePanelComic();

    expect(planComicStrips(blocks, [])).toEqual([]);
    expect(planComicStrips(blocks, [asset("a1", "missing-block")])).toEqual([]);
  });
});

describe("layoutComicStrip", () => {
  it("puts the caption after each image in image_text mode", () => {
    const group = threePanelGroup();
    const pieces = layoutComicStrip(group, "image_text");

    expect(pieces.map((piece) => piece.kind)).toEqual([
      "image",
      "text",
      "image",
      "text",
      "image",
      "text"
    ]);
  });

  it("puts the caption before each image in text_image mode", () => {
    const group = threePanelGroup();
    const pieces = layoutComicStrip(group, "text_image");

    expect(pieces.map((piece) => piece.kind)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
      "image"
    ]);
  });

  it("sandwiches one caption between two images in image_text_image mode", () => {
    const group = threePanelGroup();
    const pieces = layoutComicStrip(group, "image_text_image");

    expect(pieces.map((piece) => piece.kind)).toEqual(["image", "text", "image", "image", "text"]);
    // 中间那段要同时承载两格的标题与文案，一个字都不能丢。
    const band = pieces[1];
    if (band.kind !== "text") throw new Error("第二块应该是文字");
    expect(band.title).toBe("第一格：眼睛为什么会酸 · 第二格：眨眼少了会怎样");
    expect(band.body).toContain("盯着屏幕时眨眼次数掉了一半。");
    expect(band.body).toContain("泪膜撑不住，眼睛就开始报警。");

    // 落单的第三格退化成「图 + 文」，不会凭空少一格。
    expect(pieces[3].kind === "image" && pieces[3].panel.asset.id).toBe("a3");
  });

  it("drops the empty caption rather than emitting a blank text band", () => {
    const blocks = [
      heading("h1", "第一格", 0),
      paragraph("p1", "文案", 1),
      heading("h2", "第二格", 2),
      paragraph("p2", "文案二", 3)
    ];
    const [group] = planComicStrips(blocks, [asset("a1", "h1"), asset("a2", "h2")]);
    const pieces = layoutComicStrip(group, "image_text_image");

    expect(pieces).toHaveLength(3);
    const band = pieces[1];
    if (band.kind !== "text") throw new Error("第二块应该是文字");
    expect(band.body).toBe("文案\n文案二");
  });
});

describe("inspectComicStrip", () => {
  it("reports how many panels are ready and how many are missing", () => {
    const { blocks, assets } = threePanelComic();

    expect(inspectComicStrip(blocks, assets)).toMatchObject({
      panelCount: 3,
      missingPanels: 0
    });
    expect(inspectComicStrip(blocks, assets).groups).toHaveLength(1);
  });

  it("refuses to call a single panel a strip", () => {
    const blocks = [heading("h1", "唯一一格", 0), paragraph("p1", "文案", 1)];
    const readiness = inspectComicStrip(blocks, [asset("a1", "p1")]);

    expect(readiness.panelCount).toBe(1);
    expect(readiness.groups).toEqual([]);
    expect(readiness.missingPanels).toBe(MIN_COMIC_STRIP_PANELS - 1);
  });

  it("counts nothing for an article with no panels at all", () => {
    expect(inspectComicStrip([paragraph("p1", "正文", 0)], [])).toMatchObject({
      panelCount: 0,
      missingPanels: MIN_COMIC_STRIP_PANELS,
      groups: []
    });
  });
});
