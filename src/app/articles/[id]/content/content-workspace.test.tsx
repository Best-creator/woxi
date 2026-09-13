import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { articleFixture, twoBlocks } from "../../../../../tests/fixtures/article";
import { resolveStyleProfile } from "@/features/content/style-profile";
import type { Article } from "@/features/articles/domain";
import type { ArticleReview, ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import type { ContentReviewResult } from "@/features/content/ports";
import { ContentWorkspace } from "./content-workspace";

const outline = [
  { id: "section-1", title: "先说什么叫取舍", goal: "建立直觉", recommendedWords: 300, order: 0 },
  { id: "section-2", title: "为什么容易被忽略", goal: "说明误区", recommendedWords: 300, order: 1 }
];

const readyArticle: Article = articleFixture({
  status: "outline_ready",
  brief: {
    oneSentence: "每个选择都有代价",
    concepts: ["选择"],
    prerequisites: [],
    misconceptions: [],
    analogies: [],
    unsupportedNotes: []
  },
  outline,
  planning: {
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    confirmedOutlineRevisionId: "revision-1",
    contentOutlineRevisionId: null
  },
  outlineConfirmedAt: "2026-09-10T00:00:00.000Z"
});

const generatedArticle: Article = {
  ...readyArticle,
  status: "editing",
  blocks: twoBlocks(),
  planning: { ...readyArticle.planning, contentOutlineRevisionId: "revision-1" }
};

function revision(overrides: Partial<ArticleRevision<ContentRevisionSnapshot>> = {}): ArticleRevision<ContentRevisionSnapshot> {
  return {
    id: "content-revision-1",
    articleId: "article-1",
    scope: "content",
    version: 1,
    contentHash: "hash-1",
    model: "writer-large",
    reason: "generated",
    createdAt: "2026-09-10T00:00:00.000Z",
    snapshot: {
      title: "什么是机会成本",
      textBlocks: twoBlocks(),
      outlineRevisionId: "revision-1",
      styleProfile: resolveStyleProfile("popular_science_teacher"),
      recommendedTotalWords: 1200,
      sourceContextSnapshot: ""
    },
    ...overrides
  };
}

function reviewWith(status: ContentReviewResult["status"], blockIds: string[] = []): ArticleReview<ContentReviewResult> {
  return {
    id: "review-1",
    revisionId: "content-revision-1",
    model: "writer-large",
    createdAt: "2026-09-10T00:00:01.000Z",
    result: {
      status,
      summary: "整体可读。",
      clarity: 5,
      beginnerFriendliness: 5,
      coherence: 4,
      engagement: 4,
      outlineCoverage: 5,
      sourceFidelity: null,
      styleMatch: 4,
      issues: blockIds.length ? [{ blockIds, severity: "warning", message: "这一段需要过渡" }] : []
    }
  };
}

describe("ContentWorkspace", () => {
  it("generates the full article with the selected model and style", async () => {
    const user = userEvent.setup();
    const generateContent = vi.fn(async () => ({
      article: generatedArticle,
      revision: revision()
    }));
    render(
      <ContentWorkspace
        article={readyArticle}
        llmConfig={{ enabled: true, availableModels: ["writer-large", "writer-small"], defaultModel: "writer-large" }}
        prepareArticle={async () => readyArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        generateContent={generateContent}
      />
    );

    await user.selectOptions(screen.getByLabelText("正文模型"), "writer-small");
    await user.selectOptions(screen.getByLabelText("人物语言风格"), "friend_chat");
    await user.click(screen.getByRole("button", { name: "生成完整正文" }));

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "writer-small",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z",
      styleProfile: expect.objectContaining({ preset: "friend_chat" })
    }));
  });

  it("saves the pending draft before reviewing", async () => {
    const user = userEvent.setup();
    const persisted = { ...generatedArticle, updatedAt: "2026-09-10T00:00:05.000Z" };
    const prepareArticle = vi.fn(async () => persisted);
    const reviewContent = vi.fn(async () => ({ revision: revision(), review: reviewWith("passed") }));
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={prepareArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        reviewContent={reviewContent}
      />
    );

    await user.click(screen.getByRole("button", { name: "审核正文" }));

    expect(prepareArticle).toHaveBeenCalledOnce();
    expect(reviewContent).toHaveBeenCalledWith({
      expectedUpdatedAt: "2026-09-10T00:00:05.000Z"
    });
    expect(await screen.findByText("审核通过")).toBeVisible();
  });

  it("scrolls to and highlights the block reported by a review issue", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => generatedArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        initialVersions={[revision()]}
        initialReview={{ revision: revision(), review: reviewWith("needs_revision", ["block-paragraph-1"]) }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "这一段需要过渡" }));

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("approves the article once the review passes", async () => {
    const user = userEvent.setup();
    const approveContent = vi.fn(async () => ({
      article: { ...generatedArticle, status: "content_ready" as const },
      revision: revision(),
      review: reviewWith("passed")
    }));
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => generatedArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        initialVersions={[revision()]}
        initialReview={{ revision: revision(), review: reviewWith("passed") }}
        approveContent={approveContent}
      />
    );

    await user.click(screen.getByRole("button", { name: "确认内容" }));

    await waitFor(() => expect(approveContent).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgeWarnings: false
    })));
  });

  it("renders the confirmed outline read-only beside the editor", () => {
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => generatedArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
      />
    );

    expect(screen.getByText("先说什么叫取舍")).toBeVisible();
    expect(screen.getByLabelText("正文块 1")).toHaveValue("第一段正文");
  });
});
