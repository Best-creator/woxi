// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateContent } from "./generate-content";
import { describeAudience } from "./audience";
import { COMIC_PANEL_LIMITS } from "./comic-script";
import { DEMO_CONTENT_MODEL } from "./model";
import { resolveStyleProfile } from "./style-profile";
import type { ContentGenerator } from "./ports";
import { DemoContentGenerator } from "./demo-content-agents";
import { articleWithConfirmedOutline } from "../../../tests/helpers/content-fixture";

describe("generateContent", () => {
  it("generates a full article from the confirmed outline and records content v1", async () => {
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
        generator: new DemoContentGenerator(),
        workflow: fixture.contentWorkflow
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
    expect(result.article.blocks.length).toBeGreaterThan(3);
    expect(result.article.blocks.every((block) => block.type !== "image")).toBe(true);
    expect(result.article.blocks.map((block) => block.order)).toEqual(
      result.article.blocks.map((_, index) => index)
    );
  });

  it("adopts the title proposed by the generator", async () => {
    const fixture = await articleWithConfirmedOutline();
    const titling: ContentGenerator = {
      async generate(input) {
        const content = await new DemoContentGenerator().generate(input);
        return { ...content, title: "  《机会成本》其实很简单  " };
      }
    };

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        generator: titling,
        workflow: fixture.contentWorkflow
      }
    );

    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.article.title).toBe("《机会成本》其实很简单");
    expect(result.revision.snapshot.title).toBe("《机会成本》其实很简单");
  });

  it("keeps the current title when the generator returns a blank one", async () => {
    const fixture = await articleWithConfirmedOutline();
    const untitled: ContentGenerator = {
      async generate(input) {
        const content = await new DemoContentGenerator().generate(input);
        return { ...content, title: "   " };
      }
    };

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        generator: untitled,
        workflow: fixture.contentWorkflow
      }
    );

    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.article.title).toBe(fixture.article.title);
  });

  it("hands every confirmed section to the generator in order", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<ContentGenerator["generate"]>[0] | undefined;
    const generator: ContentGenerator = {
      async generate(input) {
        received = input;
        return new DemoContentGenerator().generate(input);
      }
    };

    await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("storyteller")
      },
      { articles: fixture.articles, sources: fixture.sources, generator, workflow: fixture.contentWorkflow }
    );

    expect(received?.outline.map((section) => section.title)).toEqual(
      fixture.article.outline.map((section) => section.title)
    );
    expect(received?.recommendedTotalWords).toBe(fixture.article.planning.recommendedTotalWords);
    expect(received?.styleProfile.preset).toBe("storyteller");
  });

  it("passes the chosen audience through as targetAudience", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<ContentGenerator["generate"]>[0] | undefined;
    const generator: ContentGenerator = {
      async generate(input) {
        received = input;
        return new DemoContentGenerator().generate(input);
      }
    };

    await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher", "", "office_desk")
      },
      { articles: fixture.articles, sources: fixture.sources, generator, workflow: fixture.contentWorkflow }
    );

    expect(received?.targetAudience).toBe(describeAudience("office_desk"));
    expect(received?.targetAudience).toContain("久坐");
  });

  it("only sends a panel limit when the comic script style is selected", async () => {
    const fixture = await articleWithConfirmedOutline();
    let received: Parameters<ContentGenerator["generate"]>[0] | undefined;
    const generator: ContentGenerator = {
      async generate(input) {
        received = input;
        return new DemoContentGenerator().generate(input);
      }
    };
    const run = (preset: Parameters<typeof resolveStyleProfile>[0], expectedUpdatedAt: string) =>
      generateContent(
        {
          articleId: fixture.article.id,
          expectedUpdatedAt,
          styleProfile: resolveStyleProfile(preset, "", "senior_reader")
        },
        { articles: fixture.articles, sources: fixture.sources, generator, workflow: fixture.contentWorkflow }
      );

    await run("science_comic_script", fixture.article.updatedAt);
    expect(received?.panelLimit).toBe(COMIC_PANEL_LIMITS[fixture.article.planning.lengthPreset]);

    // 每次生成都会推进 updatedAt，第二次必须取最新值，否则会撞乐观并发。
    const latest = await fixture.articles.findById(fixture.article.id);
    await run("popular_science_teacher", latest!.updatedAt);
    expect(received?.panelLimit).toBeUndefined();
  });

  it("falls back to the demo model when no model is selected", async () => {
    const fixture = await articleWithConfirmedOutline();
    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      { articles: fixture.articles, sources: fixture.sources, generator: new DemoContentGenerator(), workflow: fixture.contentWorkflow }
    );

    expect(result).toMatchObject({ kind: "generated", revision: { model: DEMO_CONTENT_MODEL } });
  });

  it("refuses to generate without a confirmed outline", async () => {
    const fixture = await articleWithConfirmedOutline();
    const draft = await fixture.articles.create({ topic: "沉没成本" });

    const result = await generateContent(
      {
        articleId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      { articles: fixture.articles, sources: fixture.sources, generator: new DemoContentGenerator(), workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "not_ready" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM article_revisions WHERE scope = 'content'").get())
      .toEqual({ count: 0 });
  });

  it("does not write a revision when the generator fails or returns an unknown section", async () => {
    const fixture = await articleWithConfirmedOutline();
    const failing: ContentGenerator = {
      async generate() {
        throw new Error("上游超时");
      }
    };
    const unknownSection: ContentGenerator = {
      async generate() {
        return {
          title: "标题",
          blocks: [{ sectionKey: "section-missing", type: "paragraph", content: "内容" }]
        };
      }
    };

    const failed = await generateContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, styleProfile: resolveStyleProfile("popular_science_teacher") },
      { articles: fixture.articles, sources: fixture.sources, generator: failing, workflow: fixture.contentWorkflow }
    );
    const invalid = await generateContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt, styleProfile: resolveStyleProfile("popular_science_teacher") },
      { articles: fixture.articles, sources: fixture.sources, generator: unknownSection, workflow: fixture.contentWorkflow }
    );

    expect(failed).toMatchObject({ kind: "generator_error", message: "上游超时" });
    expect(invalid).toMatchObject({ kind: "generator_error" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM article_revisions WHERE scope = 'content'").get())
      .toEqual({ count: 0 });
  });

  it("rejects stale writes without touching the current draft", async () => {
    const fixture = await articleWithConfirmedOutline();

    const result = await generateContent(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      { articles: fixture.articles, sources: fixture.sources, generator: new DemoContentGenerator(), workflow: fixture.contentWorkflow }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect((await fixture.articles.findById(fixture.article.id))?.blocks).toEqual([]);
  });
});
