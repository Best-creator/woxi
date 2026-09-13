import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { articleFixture } from "../../../../../tests/fixtures/article";
import type { OutlineReviewResult } from "@/features/outlines/domain";
import type { ArticleReview, ArticleRevision, OutlineRevisionSnapshot } from "@/features/revisions/domain";
import type { SourceDocument } from "@/features/sources/domain";
import { OutlineWorkspace } from "./outline-workspace";

const outline = [{ id: "section-1", title: "机会成本的取舍", goal: "理解取舍", recommendedWords: 500, order: 0 }];
const generatedArticle = articleFixture({
  title: "用大白话讲机会成本",
  status: "brief_ready",
  brief: { oneSentence: "每个选择都有代价", concepts: ["选择"], prerequisites: [], misconceptions: [], analogies: [], unsupportedNotes: [] },
  outline,
  planning: { lengthPreset: "standard", recommendedTotalWords: 1200, confirmedOutlineRevisionId: null, contentOutlineRevisionId: null },
  updatedAt: "2026-09-10T00:00:01.000Z"
});

const revision: ArticleRevision<OutlineRevisionSnapshot> = {
  id: "revision-1",
  articleId: "article-1",
  scope: "outline",
  version: 1,
  contentHash: "outline-hash",
  model: "writer-large",
  reason: "generated",
  createdAt: "2026-09-10T00:00:01.000Z",
  snapshot: {
    title: generatedArticle.title,
    brief: generatedArticle.brief!,
    outline,
    lengthPreset: "standard",
    recommendedTotalWords: 1200,
    sourceContextSnapshot: ""
  }
};

const passedReview: ArticleReview<OutlineReviewResult> = {
  id: "review-1",
  revisionId: revision.id,
  model: "writer-large",
  createdAt: "2026-09-10T00:00:02.000Z",
  result: { status: "passed", summary: "审核通过", coverage: 5, granularity: 5, beginnerFriendliness: 5, logicalOrder: 5, sourceSupport: null, hiddenPrerequisites: [], complexDependencies: [], issues: [] }
};

const source: SourceDocument = {
  id: "source-1",
  articleId: "article-1",
  title: "课堂笔记",
  type: "markdown",
  content: "机会成本是放弃的最佳替代方案。",
  status: "ready",
  enabled: true,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z"
};

const llmConfig = { enabled: true, availableModels: ["grok-4.6", "writer-large"], defaultModel: "grok-4.6" };

describe("OutlineWorkspace", () => {
  it("generates an outline with the selected model and standard length", async () => {
    const user = userEvent.setup();
    const generateOutline = vi.fn(async () => ({ article: generatedArticle, revision }));
    render(<OutlineWorkspace initialArticle={articleFixture()} initialSources={[]} initialVersions={[]} initialReview={null} llmConfig={llmConfig} generateOutline={generateOutline} />);

    await user.selectOptions(screen.getByLabelText("生成模型"), "writer-large");
    await user.click(screen.getByRole("button", { name: "生成理解与大纲" }));

    expect(generateOutline).toHaveBeenCalledWith(expect.objectContaining({ model: "writer-large", lengthPreset: "standard" }));
    expect(await screen.findByRole("heading", { name: "用大白话讲机会成本" })).toBeVisible();
  });

  it("marks a passed review stale immediately after a brief edit", async () => {
    const user = userEvent.setup();
    render(<OutlineWorkspace initialArticle={generatedArticle} initialSources={[]} initialVersions={[revision]} initialReview={{ revision, review: passedReview }} llmConfig={llmConfig} />);

    await user.click(screen.getByRole("button", { name: "编辑知识梳理" }));
    await user.clear(screen.getByLabelText("一句话解释"));
    await user.type(screen.getByLabelText("一句话解释"), "新的解释");

    expect(screen.getByText("大纲或资料已更新，请重新审核后再确认大纲")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
  });

  it("marks a passed review stale when an enabled source changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ source: { ...source, enabled: false } }), { status: 200 })
    );
    render(<OutlineWorkspace initialArticle={generatedArticle} initialSources={[source]} initialVersions={[revision]} initialReview={{ revision, review: passedReview }} llmConfig={llmConfig} />);

    await userEvent.click(screen.getByRole("checkbox", { name: "启用课堂笔记" }));

    expect(await screen.findByText("大纲或资料已更新，请重新审核后再确认大纲")).toBeVisible();
    fetchSpy.mockRestore();
  });

  it("prevents draft and source edits while generation is in progress", async () => {
    const user = userEvent.setup();
    let resolveGeneration!: (value: { article: typeof generatedArticle; revision: typeof revision }) => void;
    const pendingGeneration = new Promise<{ article: typeof generatedArticle; revision: typeof revision }>((resolve) => {
      resolveGeneration = resolve;
    });
    render(<OutlineWorkspace initialArticle={articleFixture()} initialSources={[source]} initialVersions={[]} initialReview={null} llmConfig={llmConfig} generateOutline={vi.fn(() => pendingGeneration)} />);

    await user.click(screen.getByRole("button", { name: "生成理解与大纲" }));

    expect(screen.getByLabelText("生成模型")).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成中..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "短篇 800-1200 字" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑知识梳理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑章节结构" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "新增章节" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加资料" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "启用课堂笔记" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除课堂笔记" })).toBeDisabled();

    await act(async () => resolveGeneration({ article: generatedArticle, revision }));
    await waitFor(() => expect(screen.getByRole("button", { name: "生成理解与大纲" })).toBeEnabled());
  });

  it("refreshes models and preserves the current selection when it remains available", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: ["grok-4.6", "gemini-3.0-pro"], defaultModel: "gemini-3.0-pro", enabled: true }), { status: 200 })
    );
    render(<OutlineWorkspace initialArticle={articleFixture()} initialSources={[]} initialVersions={[]} initialReview={null} llmConfig={llmConfig} />);

    await user.click(screen.getByRole("button", { name: "刷新可用模型" }));

    expect(await screen.findByRole("option", { name: "gemini-3.0-pro" })).toBeVisible();
    expect(screen.getByLabelText("生成模型")).toHaveValue("grok-4.6");
    expect(fetchSpy).toHaveBeenCalledWith("/api/llm/models");
    fetchSpy.mockRestore();
  });

  it("switches to the server default when the current model disappears", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: ["gemini-3.0-pro"], defaultModel: "gemini-3.0-pro", enabled: true }), { status: 200 })
    );
    render(<OutlineWorkspace initialArticle={articleFixture()} initialSources={[]} initialVersions={[]} initialReview={null} llmConfig={llmConfig} />);

    await user.click(screen.getByRole("button", { name: "刷新可用模型" }));

    await waitFor(() => expect(screen.getByLabelText("生成模型")).toHaveValue("gemini-3.0-pro"));
    fetchSpy.mockRestore();
  });

  it("places knowledge brief under sources and keeps the outline as the main column", () => {
    render(<OutlineWorkspace initialArticle={generatedArticle} initialSources={[source]} initialVersions={[revision]} initialReview={null} llmConfig={llmConfig} />);

    const sourcesColumn = screen.getByRole("complementary", { name: "资料来源" });
    expect(within(sourcesColumn).getByRole("heading", { name: "资料来源" })).toBeVisible();
    expect(within(sourcesColumn).getByRole("heading", { name: "Knowledge Brief" })).toBeVisible();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "文章大纲" })).toBeVisible();
    expect(within(screen.getByRole("main")).queryByRole("heading", { name: "Knowledge Brief" })).not.toBeInTheDocument();
  });

  it("shows compact version buttons between generation settings and the outline", () => {
    render(<OutlineWorkspace initialArticle={generatedArticle} initialSources={[]} initialVersions={[revision]} initialReview={null} llmConfig={llmConfig} />);

    const main = screen.getByRole("main");
    const generation = within(main).getByRole("heading", { name: "理解与大纲" });
    const versions = within(main).getByRole("region", { name: "大纲版本" });
    const outline = within(main).getByRole("heading", { name: "文章大纲" });
    expect(generation.compareDocumentPosition(versions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(versions.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(versions).getByRole("button", { name: "查看大纲 v1" })).toHaveTextContent("v1");
    expect(within(screen.getByRole("complementary", { name: "审核" })).queryByRole("region", { name: "大纲版本" })).not.toBeInTheDocument();
  });

  it("previews a historical outline version without replacing the current draft", async () => {
    const user = userEvent.setup();
    const olderRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-older",
      version: 1,
      reason: "generated",
      snapshot: {
        ...revision.snapshot,
        brief: { ...revision.snapshot.brief, oneSentence: "旧版一句话" },
        outline: [{ id: "section-old", title: "旧版章节", goal: "旧目标", recommendedWords: 400, order: 0 }]
      }
    };
    const currentRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-current",
      version: 2,
      reason: "manual",
      snapshot: {
        ...revision.snapshot,
        brief: { ...revision.snapshot.brief, oneSentence: generatedArticle.brief!.oneSentence },
        outline
      }
    };
    const restoreVersion = vi.fn();
    render(
      <OutlineWorkspace
        initialArticle={generatedArticle}
        initialSources={[]}
        initialVersions={[currentRevision, olderRevision]}
        initialReview={null}
        llmConfig={llmConfig}
        restoreVersion={restoreVersion}
      />
    );

    await user.click(screen.getByRole("button", { name: "查看大纲 v1" }));

    expect(screen.getByText("正在查看大纲 v1")).toBeVisible();
    expect(screen.getByText("旧版一句话")).toBeVisible();
    expect(screen.getByText("旧版章节")).toBeVisible();
    expect(screen.getByText("旧目标")).toBeVisible();
    expect(screen.getByText("400 字")).toBeVisible();
    expect(screen.queryByRole("link", { name: "旧版章节" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑知识梳理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑章节结构" })).not.toBeInTheDocument();
    expect(restoreVersion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "恢复为当前" }));
    expect(restoreVersion).toHaveBeenCalledWith("revision-older", generatedArticle.updatedAt);

    await user.click(screen.getByRole("button", { name: "查看大纲 v1" }));
    await user.click(screen.getByRole("button", { name: "返回当前草稿" }));

    expect(screen.getByText("每个选择都有代价")).toBeVisible();
    expect(screen.getByText("机会成本的取舍")).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑知识梳理" })).toBeVisible();
  });

  it("shows the selected version's review in the side panel", async () => {
    const user = userEvent.setup();
    const olderRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-older",
      version: 1,
      reason: "generated"
    };
    const currentRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-current",
      version: 2,
      reason: "review_applied"
    };
    const historicalReview: ArticleReview<OutlineReviewResult> = {
      ...passedReview,
      id: "review-older",
      revisionId: olderRevision.id,
      result: {
        ...passedReview.result,
        status: "needs_revision",
        summary: "旧版章节目标不够具体。",
        issues: [{ sectionKey: "section-1", severity: "warning", message: "请用更日常的例子开场。" }]
      }
    };
    render(
      <OutlineWorkspace
        initialArticle={generatedArticle}
        initialSources={[]}
        initialVersions={[currentRevision, olderRevision]}
        initialReview={null}
        initialVersionReviews={{ [olderRevision.id]: historicalReview }}
        llmConfig={llmConfig}
      />
    );

    expect(screen.getByText("生成大纲后可进行审核")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "查看大纲 v1" }));

    expect(screen.getByText("旧版章节目标不够具体。")).toBeVisible();
    expect(screen.getByText("请用更日常的例子开场。")).toBeVisible();
    expect(screen.queryByText("审核已过期")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核大纲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "按审核意见改大纲" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回当前草稿" }));

    expect(screen.getByText("生成大纲后可进行审核")).toBeVisible();
    expect(screen.queryByText("旧版章节目标不够具体。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核大纲" })).toBeVisible();
  });

  it("reviews the current draft when审核 is clicked while previewing a version", async () => {
    const user = userEvent.setup();
    const olderRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-older",
      version: 1,
      reason: "generated"
    };
    const currentRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-current",
      version: 2,
      reason: "review_applied"
    };
    const historicalReview: ArticleReview<OutlineReviewResult> = {
      ...passedReview,
      id: "review-older",
      revisionId: olderRevision.id,
      result: {
        ...passedReview.result,
        status: "needs_revision",
        summary: "旧版章节目标不够具体。",
        issues: [{ sectionKey: "section-1", severity: "warning", message: "请用更日常的例子开场。" }]
      }
    };
    const currentPassed: ArticleReview<OutlineReviewResult> = {
      ...passedReview,
      id: "review-current",
      revisionId: currentRevision.id
    };
    const reviewOutline = vi.fn(async () => ({ revision: currentRevision, review: currentPassed }));
    render(
      <OutlineWorkspace
        initialArticle={generatedArticle}
        initialSources={[]}
        initialVersions={[currentRevision, olderRevision]}
        initialReview={null}
        initialVersionReviews={{ [olderRevision.id]: historicalReview }}
        llmConfig={llmConfig}
        reviewOutline={reviewOutline}
      />
    );

    await user.click(screen.getByRole("button", { name: "查看大纲 v1" }));
    await user.click(screen.getByRole("button", { name: "审核大纲" }));

    expect(reviewOutline).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: generatedArticle.updatedAt }));
    expect(screen.queryByText("正在查看大纲 v1")).not.toBeInTheDocument();
    expect(screen.queryByText("旧版章节目标不够具体。")).not.toBeInTheDocument();
    expect(await screen.findByText("审核通过", { selector: ".review-status" })).toBeVisible();
  });

  it("shows a restored copy's review from the original version with the same content", async () => {
    const user = userEvent.setup();
    const originalRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-original",
      version: 1,
      contentHash: "shared-hash",
      reason: "generated"
    };
    const restoredRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-restored",
      version: 3,
      contentHash: "shared-hash",
      reason: "restored"
    };
    const rewrittenRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-rewritten",
      version: 2,
      contentHash: "other-hash",
      reason: "review_applied"
    };
    const originalReview: ArticleReview<OutlineReviewResult> = {
      ...passedReview,
      id: "review-original",
      revisionId: originalRevision.id,
      result: {
        ...passedReview.result,
        status: "needs_revision",
        summary: "旧版章节目标不够具体。",
        issues: [{ sectionKey: "section-1", severity: "warning", message: "请用更日常的例子开场。" }]
      }
    };
    render(
      <OutlineWorkspace
        initialArticle={generatedArticle}
        initialSources={[]}
        initialVersions={[restoredRevision, rewrittenRevision, originalRevision]}
        initialReview={null}
        initialVersionReviews={{ [originalRevision.id]: originalReview }}
        llmConfig={llmConfig}
      />
    );

    await user.click(screen.getByRole("button", { name: "查看大纲 v3" }));

    expect(screen.getByText("旧版章节目标不够具体。")).toBeVisible();
    expect(screen.queryByText("该版本尚未审核")).not.toBeInTheDocument();
  });

  it("applies a needs-revision review and shows the rewritten outline as a new version", async () => {
    const user = userEvent.setup();
    const warningReview: ArticleReview<OutlineReviewResult> = {
      ...passedReview,
      result: {
        ...passedReview.result,
        status: "needs_revision",
        summary: "章节目标不够具体。",
        issues: [{ sectionKey: "section-1", severity: "warning", message: "请用更日常的例子开场。" }]
      }
    };
    const rewrittenArticle = articleFixture({
      ...generatedArticle,
      title: "用日常选择讲机会成本",
      brief: { ...generatedArticle.brief!, oneSentence: "每个选择都会放弃别的可能" },
      outline: [{ id: "section-revised", title: "先从一个日常选择说起", goal: "用更日常的例子开场", recommendedWords: 500, order: 0 }],
      updatedAt: "2026-09-10T00:00:03.000Z"
    });
    const rewrittenRevision: ArticleRevision<OutlineRevisionSnapshot> = {
      ...revision,
      id: "revision-2",
      version: 2,
      reason: "review_applied",
      createdAt: "2026-09-10T00:00:03.000Z",
      snapshot: {
        ...revision.snapshot,
        title: rewrittenArticle.title,
        brief: rewrittenArticle.brief!,
        outline: rewrittenArticle.outline
      }
    };
    const applyReview = vi.fn(async () => ({ article: rewrittenArticle, revision: rewrittenRevision }));
    render(
      <OutlineWorkspace
        initialArticle={generatedArticle}
        initialSources={[]}
        initialVersions={[revision]}
        initialReview={{ revision, review: warningReview }}
        llmConfig={llmConfig}
        applyReview={applyReview}
      />
    );

    await user.click(screen.getByRole("button", { name: "按审核意见改大纲" }));

    expect(applyReview).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: generatedArticle.updatedAt }));
    expect(await screen.findByText("先从一个日常选择说起")).toBeVisible();
    expect(screen.getByText("每个选择都会放弃别的可能")).toBeVisible();
    expect(screen.getByRole("button", { name: "查看大纲 v2，审核修订" })).toBeVisible();
    expect(screen.queryByText("章节目标不够具体。")).not.toBeInTheDocument();
    expect(screen.getByText("大纲或资料已更新，请重新审核后再确认大纲")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled();
  });
});
