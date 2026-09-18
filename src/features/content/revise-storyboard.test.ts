// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  ContentReviewer,
  ReviseStoryboardDesignInput,
  StoryboardDesign,
  StoryboardDesigner
} from "./ports";
import { resolveStyleProfile } from "./style-profile";
import { reviewContent } from "./review-content";
import { reviseStoryboard } from "./revise-storyboard";
import { articleWithGeneratedContent } from "../../../tests/helpers/content-fixture";

/** 记录 revise 输入、原样（或加工后）返回当前设计的假设计器。 */
function spyDesigner(transform?: (design: StoryboardDesign) => StoryboardDesign) {
  const calls: ReviseStoryboardDesignInput[] = [];
  const designer: StoryboardDesigner = {
    design: async () => {
      throw new Error("design is not expected in revise tests");
    },
    async revise(input) {
      calls.push(input);
      return transform
        ? transform(structuredClone(input.currentDesign))
        : structuredClone(input.currentDesign);
    }
  };
  return { designer, calls };
}

function needsRevisionReviewer(copyBlockId: string): ContentReviewer {
  return {
    review: async (input) => ({
      status: "needs_revision",
      summary: `第 ${input.blocks.length} 块过于单薄`,
      clarity: 3,
      beginnerFriendliness: 3,
      coherence: 4,
      engagement: 3,
      outlineCoverage: 4,
      sourceFidelity: null,
      styleMatch: 3,
      issues: [
        { blockIds: [copyBlockId], severity: "warning", message: "该段内容过于单薄，未展开场景描绘" }
      ]
    })
  };
}

describe("reviseStoryboard", () => {
  it("requires a review before revising without personal instructions", async () => {
    const fixture = await articleWithGeneratedContent();
    const { designer } = spyDesigner();

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toEqual({ kind: "review_required" });
  });

  it("declines a passed review without personal instructions", async () => {
    const fixture = await articleWithGeneratedContent();
    const reviewed = await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        reviewer: {
          review: async () => ({
            status: "passed",
            summary: "演示审核通过",
            clarity: 5,
            beginnerFriendliness: 5,
            coherence: 5,
            engagement: 4,
            outlineCoverage: 5,
            sourceFidelity: null,
            styleMatch: 4,
            issues: []
          })
        } as unknown as ContentReviewer,
        workflow: fixture.contentWorkflow
      }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture review should pass");
    const { designer } = spyDesigner();

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toEqual({ kind: "no_revision_needed" });
  });

  it("maps review issue block ids to flagged section keys and forwards feedback", async () => {
    const fixture = await articleWithGeneratedContent();
    const segments = fixture.article.planning.storyboardSegments ?? [];
    const flaggedCopyBlockId = segments[0]!.copyBlockIds[1]!;
    const reviewed = await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        reviewer: needsRevisionReviewer(flaggedCopyBlockId),
        workflow: fixture.contentWorkflow
      }
    );
    if (reviewed.kind !== "reviewed") throw new Error("fixture review should record");
    const { designer, calls } = spyDesigner();

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    if (result.kind !== "revised") throw new Error(`expected revised, got ${result.kind}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.flaggedSectionKeys).toEqual([segments[0]!.sectionKey]);
    expect(calls[0]!.reviewFeedback).toMatchObject({ status: "needs_revision" });
    expect(calls[0]!.currentDesign.segments).toHaveLength(segments.length);
    // 设计器原样返回当前设计：全部段未变，帧资产一个都不动。
    expect(result.replacedSegments).toBe(0);
    expect(result.retainedSegments).toBe(segments.length);
    const plannedSegments = result.article.planning.storyboardSegments ?? [];
    expect(plannedSegments.map((segment) => segment.frameAssetIds)).toEqual(
      segments.map((segment) => segment.frameAssetIds)
    );
  });

  it("replaces only the segments whose content changed and records a review_applied revision", async () => {
    const fixture = await articleWithGeneratedContent();
    const segments = fixture.article.planning.storyboardSegments ?? [];
    const flaggedCopyBlockId = segments[0]!.copyBlockIds[1]!;
    await reviewContent(
      { articleId: fixture.article.id, expectedUpdatedAt: fixture.article.updatedAt },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        reviewer: needsRevisionReviewer(flaggedCopyBlockId),
        workflow: fixture.contentWorkflow
      }
    );
    const { designer } = spyDesigner((design) => {
      design.segments[0]!.copy = `${design.segments[0]!.copy}已按审核意见补充场景描绘与细节拆解。`;
      return design;
    });

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    if (result.kind !== "revised") throw new Error(`expected revised, got ${result.kind}`);
    expect(result.replacedSegments).toBe(1);
    expect(result.retainedSegments).toBe(segments.length - 1);
    expect(result.revision.reason).toBe("review_applied");

    // 改动段：新文案块 + 新占位帧，旧帧退役。
    const plannedSegments = result.article.planning.storyboardSegments ?? [];
    expect(plannedSegments[0]!.frameAssetIds).not.toEqual(segments[0]!.frameAssetIds);
    for (const oldFrameId of segments[0]!.frameAssetIds) {
      expect(await fixture.imageAssets.findById(fixture.article.id, oldFrameId)).toBeNull();
    }
    for (const newFrameId of plannedSegments[0]!.frameAssetIds) {
      expect(await fixture.imageAssets.findById(fixture.article.id, newFrameId)).toMatchObject({
        type: "storyboard",
        status: "placeholder"
      });
    }
    // 未点名段：帧资产原样保留。
    expect(plannedSegments.slice(1).map((segment) => segment.frameAssetIds)).toEqual(
      segments.slice(1).map((segment) => segment.frameAssetIds)
    );

    // 正文块：改动段换了新块（旧块消失；演示文案按空行分块 = 标题 + 2 段落），保留段沿用旧块。
    const blocks = result.article.blocks;
    expect(
      blocks.filter((block) => plannedSegments[0]!.copyBlockIds.includes(block.id))
    ).toHaveLength(3);
    expect(
      blocks.some((block) => segments[0]!.copyBlockIds.includes(block.id))
    ).toBe(false);
    for (const kept of segments.slice(1)) {
      expect(
        blocks.filter((block) => kept.copyBlockIds.includes(block.id))
      ).toHaveLength(kept.copyBlockIds.length);
    }
  });

  it("lets the author revise by personal instructions without any review", async () => {
    const fixture = await articleWithGeneratedContent();
    const { designer, calls } = spyDesigner();

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: fixture.article.updatedAt,
        styleProfile: resolveStyleProfile("popular_science_teacher"),
        userInstructions: "全部换成校园场景"
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    if (result.kind !== "revised") throw new Error(`expected revised, got ${result.kind}`);
    expect(calls[0]!.userInstructions).toBe("全部换成校园场景");
    expect(calls[0]!.reviewFeedback).toBeUndefined();
  });

  it("rejects stale lock tokens without calling the designer", async () => {
    const fixture = await articleWithGeneratedContent();
    const { designer, calls } = spyDesigner();

    const result = await reviseStoryboard(
      {
        articleId: fixture.article.id,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        styleProfile: resolveStyleProfile("popular_science_teacher")
      },
      {
        articles: fixture.articles,
        sources: fixture.sources,
        designer,
        workflow: fixture.contentWorkflow,
        images: fixture.imageAssets
      }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect(calls).toHaveLength(0);
  });
});
