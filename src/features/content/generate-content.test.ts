// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateContent, splitStoryboardCopy } from "./generate-content";
import { describeAudience } from "./audience";
import { DEMO_CONTENT_MODEL } from "./model";
import { resolveStyleProfile } from "./style-profile";
import type { StoryboardDesigner } from "./ports";
import { DemoStoryboardDesigner } from "./demo-storyboard-designer";
import { articleWithConfirmedOutline } from "../../../tests/helpers/content-fixture";

/** 只关心 design 的假设计器：revise 不该在生成链路里被调用。 */
function fakeDesigner(design: StoryboardDesigner["design"]): StoryboardDesigner {
  return {
    design,
    async revise() {
      throw new Error("revise is not expected in generateContent tests");
    }
  };
}

describe("generateContent", () => {
  it("designs storyboard segments from the confirmed outline and records content v1", async () => {
    const fixture = await articleWithConfirmedOutline();
    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        model: "writer-large",
        styleProfile: resolveStyleProfile("friend_chat", "少用反问句")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toMatchObject({
      kind: "generated",
      article: {
        status: "editing",
        planning: {
          contentOutlineRevisionId: fixture.article.planning.confirmedOutlineRevisionId
        },
        styleProfile: { preset: "friend_chat", customInstructions: "少用反问句" }
      },
      revision: { scope: "content", version: 1, model: "writer-large", reason: "generated" }
    });
    if (result.kind !== "generated") throw new Error("expected generated");
    // 每段 = 标题块 + copy 按空行分块后的段落块；无图片块（分镜帧是独立资产，不进正文块）。
    const plannedSegments = result.article.planning.storyboardSegments ?? [];
    expect(result.article.blocks.length).toBe(
      plannedSegments.reduce((total, segment) => total + segment.copyBlockIds.length, 0)
    );
    expect(result.article.blocks.every((block) => block.type !== "image")).toBe(true);
    expect(result.article.blocks.map((block) => block.order)).toEqual(
      result.article.blocks.map((_, index) => index)
    );

    // 分镜设计落库：段数对齐大纲，帧资产真实存在，文案块互相咬合。
    const segments = plannedSegments;
    expect(segments.map((segment) => segment.sectionKey)).toEqual(
      fixture.article.outline.map((section) => section.id)
    );
    expect(segments.map((segment) => segment.order)).toEqual(
      segments.map((_, index) => index)
    );
    for (const segment of segments) {
      const copyBlocks = result.article.blocks.filter((block) =>
        segment.copyBlockIds.includes(block.id)
      );
      expect(copyBlocks.map((block) => block.segmentId)).toEqual(
        segment.copyBlockIds.map(() => segment.id)
      );
      // 分块节奏：标题块打头，后面至少 2 个段落块（演示文案用空行分成短块）。
      expect(copyBlocks[0]?.type).toBe("heading");
      expect(copyBlocks.slice(1).map((block) => block.type)).toEqual(
        copyBlocks.slice(1).map(() => "paragraph")
      );
      expect(copyBlocks.length).toBeGreaterThanOrEqual(3);
      for (const frameAssetId of segment.frameAssetIds) {
        const asset = await fixture.imageAssets.findById(result.article.id, frameAssetId);
        expect(asset).toMatchObject({ type: "storyboard", status: "placeholder" });
      }
    }
    // 演示路由：首段 图+文，中段 图+文+图，末段 文+图（覆盖三种排法）。
    expect(segments[0]?.route).toBe("image_text");
    expect(segments[segments.length - 1]?.route).toBe("text_image");
    expect(segments[1]?.route).toBe("image_text_image");
  });

  it("records the storyboard design in the version snapshot for step-four resubmission", async () => {
    const fixture = await articleWithConfirmedOutline();
    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("friend_chat")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );
    if (result.kind !== "generated") throw new Error("expected generated");

    // 版本快照携带本次设计：恢复旧版本时按帧描述符重建占位帧，重新提交给第四步。
    const versions = await fixture.contentWorkflow.listContentVersions(result.article.id);
    const segments = versions[0]?.snapshot.storyboardSegments ?? [];
    expect(segments.map((segment) => segment.sectionKey)).toEqual(
      (result.article.planning.storyboardSegments ?? []).map((segment) => segment.sectionKey)
    );
    for (const segment of segments) {
      expect(segment.frames.length).toBeGreaterThan(0);
      for (const frame of segment.frames) {
        expect(frame.prompt.length).toBeGreaterThan(0);
        expect(frame.altText.length).toBeGreaterThan(0);
      }
      // 生成落库前快照没有帧资产 id：恢复时走「按描述符重建」。
      expect(segment.frameAssetIds).toBeUndefined();
    }
  });

  it("adopts the title proposed by the designer", async () => {
    const fixture = await articleWithConfirmedOutline();
    const titling = fakeDesigner(async (input) => {
      const design = await new DemoStoryboardDesigner().design(input);
      return { ...design, title: "  《机会成本》其实很简单  " };
    });

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: titling,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.article.title).toBe("《机会成本》其实很简单");
    expect(result.revision.snapshot.title).toBe("《机会成本》其实很简单");
  });

  it("keeps the current title when the designer returns a blank one", async () => {
    const fixture = await articleWithConfirmedOutline();
    const untitled = fakeDesigner(async (input) => {
      const design = await new DemoStoryboardDesigner().design(input);
      return { ...design, title: "   " };
    });

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: untitled,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.article.title).toBe(fixture.article.title);
  });

  it("hands every confirmed section to the designer in order", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<StoryboardDesigner["design"]>[0] | undefined;
    const designer = fakeDesigner(async (input) => {
      received = input;
      return new DemoStoryboardDesigner().design(input);
    });

    await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("storyteller")
      },
      { articles: fixture.articles, sources: fixture.sources, designer, workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );

    expect(received?.outline.map((section) => section.title)).toEqual(
      fixture.article.outline.map((section) => section.title)
    );
    expect(received?.recommendedTotalWords).toBe(fixture.article.planning.recommendedTotalWords);
    expect(received?.styleProfile.preset).toBe("storyteller");
  });

  it("forwards drawing style and character into the design input", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<StoryboardDesigner["design"]>[0] | undefined;
    const designer = fakeDesigner(async (input) => {
      received = input;
      return new DemoStoryboardDesigner().design(input);
    });
    const character = { name: "小知", persona: "科普讲解员", description: "圆框眼镜、蓝色马甲" };

    await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher"),
        drawingStyle: "水墨漫画风",
        character
      },
      { articles: fixture.articles, sources: fixture.sources, designer, workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );

    expect(received?.drawingStyle).toBe("水墨漫画风");
    expect(received?.character).toEqual(character);
  });

  it("passes the chosen audience through as targetAudience", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<StoryboardDesigner["design"]>[0] | undefined;
    const designer = fakeDesigner(async (input) => {
      received = input;
      return new DemoStoryboardDesigner().design(input);
    });

    await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher", "", "office_desk")
      },
      { articles: fixture.articles, sources: fixture.sources, designer, workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );

    expect(received?.targetAudience).toBe(describeAudience("office_desk"));
    expect(received?.targetAudience).toContain("久坐");
  });

  it("falls back to the demo model when no model is selected", async () => {
    const fixture = await articleWithConfirmedOutline();
    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toMatchObject({ kind: "generated", revision: { model: DEMO_CONTENT_MODEL } });
  });

  it("refuses to design without a confirmed outline", async () => {
    const fixture = await articleWithConfirmedOutline();
    const draft = await fixture.articles.create({ topic: "沉没成本" });

    const result = await generateContent(
      {
        articleId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toEqual({ kind: "not_ready" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM article_revisions WHERE scope = 'content'").get())
      .toEqual({ count: 0 });
  });

  it("does not write a revision when the designer fails", async () => {
    const fixture = await articleWithConfirmedOutline();
    const failing = fakeDesigner(async () => {
      throw new Error("上游超时");
    });

    const failed = await generateContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, styleProfile: resolveStyleProfile("popular_science_teacher") },
      { articles: fixture.articles, sources: fixture.sources, designer: failing, workflow: fixture.contentWorkflow, images: fixture.imageAssets }
    );

    expect(failed).toMatchObject({ kind: "designer_error", message: "上游超时" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM article_revisions WHERE scope = 'content'").get())
      .toEqual({ count: 0 });
  });

  it("retires the previous design's frames when redesigning", async () => {
    const fixture = await articleWithConfirmedOutline();
    const first = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );
    if (first.kind !== "generated") throw new Error("expected first design");
    const firstFrameIds = (first.article.planning.storyboardSegments ?? [])
      .flatMap((segment) => segment.frameAssetIds);

    const second = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: first.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );
    if (second.kind !== "generated") throw new Error("expected second design");

    const secondFrameIds = (second.article.planning.storyboardSegments ?? [])
      .flatMap((segment) => segment.frameAssetIds);
    expect(secondFrameIds.length).toBeGreaterThan(0);
    for (const frameId of firstFrameIds) {
      expect(secondFrameIds).not.toContain(frameId);
      expect(await fixture.imageAssets.findById(fixture.article.id, frameId)).toBeNull();
    }
  });

  it("rejects stale writes without touching the current draft", async () => {
    const fixture = await articleWithConfirmedOutline();

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer: new DemoStoryboardDesigner(),
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect((await fixture.articles.findById(fixture.article.id))?.blocks).toEqual([]);
  });
});

describe("splitStoryboardCopy", () => {
  it("splits copy on blank lines into trimmed short blocks", () => {
    expect(splitStoryboardCopy("第一块。\n\n第二块。\n\n\n第三块。")).toEqual([
      "第一块。",
      "第二块。",
      "第三块。"
    ]);
  });

  it("keeps copy without blank lines as a single block (legacy articles)", () => {
    expect(splitStoryboardCopy("一整段没有空行的旧文案")).toEqual(["一整段没有空行的旧文案"]);
  });

  it("drops whitespace-only chunks and keeps a hard line break inside a block", () => {
    expect(splitStoryboardCopy("第一块第一行。\n第一块第二行。\n\n   \n第二块。")).toEqual([
      "第一块第一行。\n第一块第二行。",
      "第二块。"
    ]);
  });
});
