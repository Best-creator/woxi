import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { articleFixture, twoBlocks } from "../../../../../tests/fixtures/article";
import { resolveStyleProfile } from "@/features/content/style-profile";
import type { Article, ContentBlock, StoryboardSegment } from "@/features/articles/domain";
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

/** 已完成分镜设计的正文：每段 = 标题块 + 文案块，路由覆盖两种排法。 */
const storyboardSegments: StoryboardSegment[] = [
  {
    id: "seg-1",
    sectionKey: "section-1",
    title: "开场",
    route: "image_text",
    copyBlockIds: ["seg1-h", "seg1-p"],
    frameAssetIds: ["frame-1"],
    order: 0
  },
  {
    id: "seg-2",
    sectionKey: "section-2",
    title: "机制",
    route: "text_image",
    copyBlockIds: ["seg2-h", "seg2-p"],
    frameAssetIds: ["frame-2"],
    order: 1
  }
];

const storyboardBlocks: ContentBlock[] = [
  { id: "seg1-h", type: "heading", content: "开场", order: 0, level: 2, segmentId: "seg-1", version: 1 },
  { id: "seg1-p", type: "paragraph", content: "第一段文案。", order: 1, segmentId: "seg-1", version: 1 },
  { id: "seg2-h", type: "heading", content: "机制", order: 2, level: 2, segmentId: "seg-2", version: 1 },
  { id: "seg2-p", type: "paragraph", content: "第二段文案。", order: 3, segmentId: "seg-2", version: 1 }
];

const storyboardArticle: Article = {
  ...generatedArticle,
  blocks: storyboardBlocks,
  planning: { ...generatedArticle.planning, storyboardSegments }
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
      hookStrength: 4,
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
      article: storyboardArticle,
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
    await user.click(screen.getByRole("button", { name: "生成分镜脚本" }));

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "writer-small",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z",
      styleProfile: expect.objectContaining({ preset: "friend_chat" })
    }));
    // 生成成功后交代分镜结构：2 段、各 1 帧（storyboardSegments fixture 的帧数之和）。
    expect(await screen.findByText("分镜脚本已生成：2 段，共 2 帧待生成")).toBeVisible();
  });

  it("defaults a brand-new article to the story comic form and submits the author's choice", async () => {
    const user = userEvent.setup();
    const generateContent = vi.fn(async () => ({
      article: storyboardArticle,
      revision: revision()
    }));
    render(
      <ContentWorkspace
        article={readyArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => readyArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        generateContent={generateContent}
      />
    );

    // 没设计过分镜的新文：默认剧情漫画，等于已落库的推断值，所以不提示「待生效」。
    const select = screen.getByLabelText("呈现形态");
    expect(select).toHaveValue("story_comic");
    expect(screen.queryByText("这一形态会在下次「生成分镜脚本」时生效。")).not.toBeInTheDocument();

    await user.selectOptions(select, "illustrated");
    // 改了但还没生成：明确提示这不是已生效的形态。
    expect(screen.getByText("这一形态会在下次「生成分镜脚本」时生效。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "生成分镜脚本" }));

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ presentation: "illustrated" })
    );
  });

  it("keeps an article that already has a storyboard design on the illustrated form", () => {
    render(
      <ContentWorkspace
        article={storyboardArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => storyboardArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
      />
    );

    // 旧文（有 segments、planning 里没有形态字段）不会因为新默认而变形。
    expect(screen.getByLabelText("呈现形态")).toHaveValue("illustrated");
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

    await user.click(screen.getByRole("button", { name: "审核文案" }));

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

  it("approves the article once the review passes and advances to the next step", async () => {
    const user = userEvent.setup();
    const onContentApproved = vi.fn();
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
        onContentApproved={onContentApproved}
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
    await waitFor(() => expect(onContentApproved).toHaveBeenCalled());
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

  it("shows an automatic word count summary with the recommended total", () => {
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => generatedArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
      />
    );

    const summary = screen.getByRole("status", { name: "正文字数统计" });
    // twoBlocks() 两段各 5 个非空白字符，共 10 字、2 块；目标 1200 字，偏差 -99%。
    expect(summary).toHaveTextContent("正文约 10 字");
    expect(summary).toHaveTextContent("2 个内容块");
    expect(summary).toHaveTextContent("目标约 1200 字");
    expect(summary).toHaveTextContent("还差 99%");
  });

  it("renders storyboard segment cards once a design exists", async () => {
    const user = userEvent.setup();
    const onEditPlanning = vi.fn();
    render(
      <ContentWorkspace
        article={storyboardArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => storyboardArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
        onEditPlanning={onEditPlanning}
      />
    );

    expect(screen.getByRole("region", { name: "正文工作台" })).toBeVisible();
    // 中栏按段拆卡：卡标题可见、未分段组退场、块编号跨卡全页唯一。
    // （卡内 textarea 的 textContent 与标题同文案，用 heading 角色精确定位。）
    expect(screen.getByRole("heading", { name: "开场" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "机制" })).toBeVisible();
    expect(screen.queryByText("未分段文案")).not.toBeInTheDocument();
    expect(screen.getByLabelText("正文块 1")).toHaveValue("第一段文案。");
    expect(screen.getByLabelText("正文块 2")).toHaveValue("第二段文案。");

    // 排法覆盖只改 planning 对应段，其余段原样保留。
    await user.selectOptions(screen.getByLabelText("开场 排法"), "text_image");
    expect(onEditPlanning).toHaveBeenCalledWith({
      storyboardSegments: [
        { ...storyboardSegments[0], route: "text_image" },
        storyboardSegments[1]
      ]
    });
  });

  it("shows the unsegmented guide for articles without a storyboard design", () => {
    render(
      <ContentWorkspace
        article={generatedArticle}
        llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
        prepareArticle={async () => generatedArticle}
        onArticleChange={vi.fn()}
        onEditBlocks={vi.fn()}
      />
    );

    // 旧文兼容：一律用新 UI，但给旧文章一条明确的指引而不是静默装作没事。
    expect(screen.getByText("未分段文案")).toBeVisible();
    expect(screen.getByText("这篇正文还没有分镜设计")).toBeVisible();
  });

  describe("storyboard revision", () => {
    const storyboardRevision = revision({
      snapshot: {
        title: storyboardArticle.title,
        textBlocks: storyboardBlocks,
        outlineRevisionId: "revision-1",
        styleProfile: storyboardArticle.styleProfile,
        recommendedTotalWords: 1200,
        sourceContextSnapshot: ""
      }
    });

    /** 真实应用由 article-workspace 持有 article 状态并回传给本组件，这里同构。 */
    function reviseFixture(reviseContent: unknown) {
      function Harness() {
        const [article, setArticle] = useState(storyboardArticle);
        return (
          <ContentWorkspace
            article={article}
            llmConfig={{ enabled: false, availableModels: [], defaultModel: null }}
            prepareArticle={async () => article}
            onArticleChange={setArticle}
            onEditBlocks={vi.fn()}
            initialVersions={[storyboardRevision]}
            initialReview={{ revision: storyboardRevision, review: reviewWith("needs_revision", ["seg1-p"]) }}
            reviseContent={reviseContent as never}
          />
        );
      }
      return render(<Harness />);
    }

    it("applies review feedback through the converged entry and reports what was replaced", async () => {
      const user = userEvent.setup();
      // 真实修订会改写被点名段的文案：mock 文章同步改掉，过期判定才有依据。
      const revisedBlocks = storyboardBlocks.map((block) =>
        block.id === "seg1-p" ? { ...block, content: "第一段文案（已按意见充实）。" } : block
      );
      const reviseContent = vi.fn(async () => ({
        article: { ...storyboardArticle, blocks: revisedBlocks, updatedAt: "2026-09-10T00:00:09.000Z" },
        revision: revision({ id: "content-revision-2", reason: "review_applied" }),
        replacedSegments: 1,
        retainedSegments: 1
      }));
      reviseFixture(reviseContent);

      await user.click(screen.getByRole("button", { name: "按审核意见改分镜" }));

      expect(reviseContent).toHaveBeenCalledWith(expect.objectContaining({
        expectedUpdatedAt: storyboardArticle.updatedAt
      }));
      expect(await screen.findByText(/分镜已修订：更新 1 段/)).toBeVisible();
      expect(screen.getByText(/请重新审核后再确认内容/)).toBeVisible();
      // 旧审核保留展示并标记过期（对齐改大纲）：意见留在面板上供继续迭代，
      // 确认按钮被锁住直到重新审核。
      expect(await screen.findByText("审核已过期")).toBeVisible();
      expect(screen.getByRole("button", { name: "确认内容" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "审核文案" })).toBeEnabled();
    });

    it("sends personal instructions through the revise entry", async () => {
      const user = userEvent.setup();
      const reviseContent = vi.fn(async () => ({
        article: storyboardArticle,
        revision: revision({ id: "content-revision-2", reason: "review_applied" }),
        replacedSegments: 2,
        retainedSegments: 0
      }));
      reviseFixture(reviseContent);

      await user.type(screen.getByLabelText(/补充要求/), "把开场换成校园场景");
      await user.click(screen.getByRole("button", { name: "按我的意见改分镜" }));

      expect(reviseContent).toHaveBeenCalledWith(expect.objectContaining({
        userInstructions: "把开场换成校园场景"
      }));
    });
  });
});
