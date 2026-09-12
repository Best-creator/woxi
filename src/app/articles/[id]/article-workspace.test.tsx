import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { articleFixture, twoBlocks } from "../../../../tests/fixtures/article";
import type { Article } from "@/features/articles/domain";
import { DEFAULT_STYLE_PROFILE } from "@/features/content/style-profile";
import type { ArticleRevision, ContentRevisionSnapshot } from "@/features/revisions/domain";
import type { ImageAsset } from "@/features/images/domain";
import { ArticleWorkspace } from "./article-workspace";

function contentRevision(overrides: Partial<ArticleRevision<ContentRevisionSnapshot>> = {}): ArticleRevision<ContentRevisionSnapshot> {
  return {
    id: "content-revision-1",
    articleId: "article-1",
    scope: "content",
    version: 1,
    contentHash: "content-hash",
    model: "writer-large",
    reason: "generated",
    createdAt: "2026-09-10T00:00:00.000Z",
    snapshot: {
      title: "什么是机会成本",
      textBlocks: twoBlocks(),
      outlineRevisionId: "revision-1",
      styleProfile: DEFAULT_STYLE_PROFILE,
      recommendedTotalWords: 1200,
      sourceContextSnapshot: ""
    },
    ...overrides
  };
}

describe("ArticleWorkspace", () => {
  const imageAsset: ImageAsset = {
    id: "asset-1",
    articleId: "article-1",
    type: "concept",
    anchorBlockId: "block-paragraph-1",
    purpose: "解释核心概念",
    prompt: "清晰信息图",
    altText: "概念图",
    aspectRatio: "landscape",
    status: "placeholder",
    placeholderUrl: "/api/image-assets/asset-1/content",
    filePath: null,
    publicUrl: null,
    manuallyEdited: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z"
  };

  const confirmedPlanning = {
    lengthPreset: "standard" as const,
    recommendedTotalWords: 1200,
    confirmedOutlineRevisionId: "revision-1",
    contentOutlineRevisionId: null
  };
  const currentDraftPlanning = {
    ...confirmedPlanning,
    contentOutlineRevisionId: "revision-1"
  };
  const confirmedArticle = (overrides: Parameters<typeof articleFixture>[0] = {}) =>
    articleFixture({
      brief: {
        oneSentence: "每个选择都有代价",
        concepts: ["选择"],
        prerequisites: [],
        misconceptions: [],
        analogies: [],
        unsupportedNotes: []
      },
      outline: [{ id: "section-1", title: "理解取舍", order: 0 }],
      planning: confirmedPlanning,
      outlineConfirmedAt: "2026-09-10T00:00:00.000Z",
      status: "outline_ready",
      ...overrides
    });
  const currentArticleDraft = (overrides: Parameters<typeof articleFixture>[0] = {}) =>
    confirmedArticle({
      status: "editing",
      blocks: twoBlocks(),
      planning: currentDraftPlanning,
      ...overrides
    });

  it("renders the four-step progress bar", () => {
    render(<ArticleWorkspace initialArticle={articleFixture()} />);

    expect(screen.getByRole("navigation", { name: "文章工作流" })).toBeVisible();
    expect(screen.getByRole("button", { name: /资料来源.*当前/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /文章大纲/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /正文文章/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /配图/ })).toBeVisible();
  });

  it("does not invoke generation from locked article or image steps", async () => {
    const user = userEvent.setup();
    const generateContent = vi.fn();
    const planImages = vi.fn();
    render(
      <ArticleWorkspace
        initialArticle={articleFixture()}
        generateContent={generateContent}
        planImages={planImages}
      />
    );

    await user.click(screen.getByRole("button", { name: /正文文章.*已锁定/ }));
    await user.click(screen.getByRole("button", { name: /配图.*已锁定/ }));

    expect(generateContent).not.toHaveBeenCalled();
    expect(planImages).not.toHaveBeenCalled();
  });

  it("generates the full article with the selected content model", async () => {
    const user = userEvent.setup();
    const generated = currentArticleDraft({
      updatedAt: "2026-09-10T00:00:01.000Z"
    });
    const generateContent = vi.fn(async () => ({
      article: generated,
      revision: contentRevision()
    }));
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle()}
        initialStep="article"
        llmConfig={{ enabled: true, availableModels: ["writer-small", "writer-large"], defaultModel: "writer-small" }}
        generateContent={generateContent}
      />
    );

    await user.selectOptions(screen.getByLabelText("正文模型"), "writer-large");
    await user.click(screen.getByRole("button", { name: "生成完整正文" }));

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "writer-large",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z"
    }));
  });

  it("still offers full article generation when leftover blocks are not bound to the confirmed outline", async () => {
    const user = userEvent.setup();
    const generateContent = vi.fn(async () => ({
      article: currentArticleDraft({
        updatedAt: "2026-09-10T00:00:01.000Z"
      }),
      revision: contentRevision()
    }));
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle({
          blocks: [
            {
              id: "legacy-demo",
              type: "paragraph",
              content: "用大白话讲清楚：什么是机会成本可以从“它是什么、为什么重要、如何影响日常选择”三个角度理解。",
              order: 0,
              version: 1
            }
          ]
        })}
        initialStep="article"
        llmConfig={{ enabled: true, availableModels: ["writer-large"], defaultModel: "writer-large" }}
        generateContent={generateContent}
      />
    );

    expect(screen.getByRole("button", { name: "生成完整正文" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "生成完整正文" }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "writer-large",
      expectedUpdatedAt: "2026-09-09T00:00:00.000Z"
    }));
  });

  it("runs the existing image-plan operation from the image step", async () => {
    const user = userEvent.setup();
    const article = currentArticleDraft();
    const planImages = vi.fn(async () => ({ article, assets: [imageAsset] }));
    render(
      <ArticleWorkspace
        initialArticle={article}
        initialStep="images"
        planImages={planImages}
      />
    );

    await user.click(screen.getByRole("button", { name: "分析配图需求" }));

    expect(planImages).toHaveBeenCalledWith("article-1", "2026-09-09T00:00:00.000Z");
  });

  it("persists an embedded outline edit after navigating away before its debounce", async () => {
    const user = userEvent.setup();
    const savedTokens: string[] = [];
    const saveArticle = vi.fn(async (article: Article, expectedUpdatedAt: string) => {
      savedTokens.push(expectedUpdatedAt);
      return {
        kind: "saved" as const,
        article: { ...article, updatedAt: "2026-09-10T00:00:01.000Z" }
      };
    });
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle()}
        initialStep="outline"
        saveArticle={saveArticle}
        autosaveDelayMs={0}
      />
    );

    await user.click(screen.getByRole("button", { name: "编辑知识梳理" }));
    await user.clear(screen.getByLabelText("一句话解释"));
    await user.type(screen.getByLabelText("一句话解释"), "新的大纲理解");
    await user.click(screen.getByRole("button", { name: /资料来源/ }));

    await waitFor(() => expect(saveArticle.mock.calls.some(([saved]) => saved.brief?.oneSentence === "新的大纲理解")).toBe(true));
    const finalIndex = saveArticle.mock.calls.findIndex(([saved]) => saved.brief?.oneSentence === "新的大纲理解");
    expect(savedTokens[finalIndex]).toBe("2026-09-09T00:00:00.000Z");
  });

  it("keeps a saved outline review after leaving the outline step and coming back", async () => {
    const user = userEvent.setup();
    const revision = {
      id: "revision-1",
      articleId: "article-1",
      scope: "outline" as const,
      version: 1,
      contentHash: "outline-hash",
      model: "writer-large",
      reason: "review_checkpoint" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      snapshot: {
        title: "用大白话讲机会成本",
        brief: {
          oneSentence: "每个选择都有代价",
          concepts: ["选择"],
          prerequisites: [],
          misconceptions: [],
          analogies: [],
          unsupportedNotes: []
        },
        outline: [{ id: "section-1", title: "理解取舍", order: 0 }],
        lengthPreset: "standard" as const,
        recommendedTotalWords: 1200,
        sourceContextSnapshot: ""
      }
    };
    const review = {
      id: "review-1",
      revisionId: revision.id,
      model: "writer-large",
      createdAt: "2026-09-10T00:00:01.000Z",
      result: {
        status: "passed" as const,
        summary: "结构清楚，可以确认",
        coverage: 5,
        granularity: 5,
        beginnerFriendliness: 5,
        logicalOrder: 5,
        sourceSupport: null,
        hiddenPrerequisites: [],
        complexDependencies: [],
        issues: []
      }
    };
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle()}
        initialStep="outline"
        initialVersions={[revision]}
        initialReview={{ revision, review }}
      />
    );

    expect(screen.getByText("结构清楚，可以确认")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /资料来源/ }));
    expect(screen.queryByText("结构清楚，可以确认")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /文章大纲/ }));
    expect(screen.getByText("结构清楚，可以确认")).toBeVisible();
  });

  it("enters the article step after confirming an outline", async () => {
    const user = userEvent.setup();
    const brief = {
      oneSentence: "每个选择都有代价",
      concepts: ["选择"],
      prerequisites: [],
      misconceptions: [],
      analogies: [],
      unsupportedNotes: []
    };
    const outline = [{ id: "section-1", title: "理解取舍", order: 0 }];
    const revision = {
      id: "revision-1",
      articleId: "article-1",
      scope: "outline" as const,
      version: 1,
      contentHash: "outline-hash",
      model: "writer-large",
      reason: "review_checkpoint" as const,
      createdAt: "2026-09-10T00:00:01.000Z",
      snapshot: {
        title: "用大白话讲机会成本",
        brief,
        outline,
        lengthPreset: "standard" as const,
        recommendedTotalWords: 1200,
        sourceContextSnapshot: ""
      }
    };
    const review = {
      id: "review-1",
      revisionId: revision.id,
      model: "writer-large",
      createdAt: "2026-09-10T00:00:02.000Z",
      result: {
        status: "passed" as const,
        summary: "结构清楚，可以确认",
        coverage: 5,
        granularity: 5,
        beginnerFriendliness: 5,
        logicalOrder: 5,
        sourceSupport: null,
        hiddenPrerequisites: [],
        complexDependencies: [],
        issues: []
      }
    };
    const confirmed = confirmedArticle({
      title: "用大白话讲机会成本",
      brief,
      outline,
      updatedAt: "2026-09-10T00:00:03.000Z"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ article: confirmed, revision, review }), { status: 200 })
    );
    render(
      <ArticleWorkspace
        initialArticle={articleFixture({
          title: "用大白话讲机会成本",
          status: "brief_ready",
          brief,
          outline,
          planning: {
            lengthPreset: "standard",
            recommendedTotalWords: 1200,
            confirmedOutlineRevisionId: null,
            contentOutlineRevisionId: null
          },
          updatedAt: "2026-09-10T00:00:01.000Z"
        })}
        initialStep="outline"
        initialVersions={[revision]}
        initialReview={{ revision, review }}
      />
    );

    await user.click(screen.getByRole("button", { name: "确认大纲" }));

    expect(await screen.findByRole("button", { name: "生成完整正文" })).toBeVisible();
    expect(screen.getByRole("button", { name: /正文文章.*当前/ })).toHaveAttribute("aria-current", "step");
    expect(window.location.search).toContain("step=article");
    fetchSpy.mockRestore();
  });

  it("stays on the outline step when confirmation fails", async () => {
    const user = userEvent.setup();
    const brief = {
      oneSentence: "每个选择都有代价",
      concepts: ["选择"],
      prerequisites: [],
      misconceptions: [],
      analogies: [],
      unsupportedNotes: []
    };
    const outline = [{ id: "section-1", title: "理解取舍", order: 0 }];
    const revision = {
      id: "revision-1",
      articleId: "article-1",
      scope: "outline" as const,
      version: 1,
      contentHash: "outline-hash",
      model: "writer-large",
      reason: "review_checkpoint" as const,
      createdAt: "2026-09-10T00:00:01.000Z",
      snapshot: {
        title: "用大白话讲机会成本",
        brief,
        outline,
        lengthPreset: "standard" as const,
        recommendedTotalWords: 1200,
        sourceContextSnapshot: ""
      }
    };
    const review = {
      id: "review-1",
      revisionId: revision.id,
      model: "writer-large",
      createdAt: "2026-09-10T00:00:02.000Z",
      result: {
        status: "passed" as const,
        summary: "结构清楚，可以确认",
        coverage: 5,
        granularity: 5,
        beginnerFriendliness: 5,
        logicalOrder: 5,
        sourceSupport: null,
        hiddenPrerequisites: [],
        complexDependencies: [],
        issues: []
      }
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "当前大纲尚未审核或审核已过期" }), { status: 400 })
    );
    render(
      <ArticleWorkspace
        initialArticle={articleFixture({
          title: "用大白话讲机会成本",
          status: "brief_ready",
          brief,
          outline,
          planning: {
            lengthPreset: "standard",
            recommendedTotalWords: 1200,
            confirmedOutlineRevisionId: null,
            contentOutlineRevisionId: null
          },
          updatedAt: "2026-09-10T00:00:01.000Z"
        })}
        initialStep="outline"
        initialVersions={[revision]}
        initialReview={{ revision, review }}
      />
    );

    await user.click(screen.getByRole("button", { name: "确认大纲" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前大纲尚未审核或审核已过期");
    expect(screen.getByRole("button", { name: "确认大纲" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "生成完整正文" })).not.toBeInTheDocument();
    expect(window.location.search).toContain("step=outline");
    fetchSpy.mockRestore();
  });

  it("invalidates a confirmed outline and body when a source changes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ source: { id: "source-1", articleId: "article-1", title: "课堂笔记", type: "markdown", content: "新资料", status: "ready", enabled: true, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" } }), { status: 201 })
    );
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle({ status: "editing", blocks: twoBlocks() })}
        initialStep="sources"
        autosaveDelayMs={60_000}
      />
    );

    await user.click(screen.getByRole("button", { name: "添加资料" }));
    await user.type(screen.getByLabelText("资料标题"), "课堂笔记");
    await user.type(screen.getByLabelText("资料内容"), "新资料");
    await user.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("button", { name: /正文文章.*已锁定/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /配图.*已锁定/ })).toBeDisabled();
    expect(screen.queryByLabelText("正文块 1")).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("shows a conflict without replacing local edits", async () => {
    const user = userEvent.setup();
    render(
      <ArticleWorkspace
        initialArticle={currentArticleDraft()}
        saveArticle={async () => ({ kind: "conflict" })}
        autosaveDelayMs={0}
      />
    );

    await user.clear(screen.getByLabelText("正文块 1"));
    await user.type(screen.getByLabelText("正文块 1"), "本地修改");

    await waitFor(() =>
      expect(screen.getByText(/文章已在其他位置更新/)).toBeVisible()
    );
    expect(screen.getByDisplayValue("本地修改")).toBeVisible();
  });

  it("generates the first article draft after outline confirmation", async () => {
    const user = userEvent.setup();
    const generated = currentArticleDraft({
      title: "用大白话讲清楚：机会成本",
      updatedAt: "2026-09-09T00:00:01.000Z"
    });
    render(
      <ArticleWorkspace
        initialArticle={confirmedArticle()}
        generateContent={async () => ({ article: generated, revision: contentRevision() })}
      />
    );

    await user.click(screen.getByRole("button", { name: "生成完整正文" }));

    expect(
      await screen.findByRole("heading", { name: "用大白话讲清楚：机会成本" })
    ).toBeVisible();
    expect(screen.getByDisplayValue("第一段正文")).toBeVisible();
  });

  it("autosaves brief edits", async () => {
    const saveArticle = vi.fn(async (article) => ({
      kind: "saved" as const,
      article: { ...article, updatedAt: "2026-09-09T00:00:02.000Z" }
    }));
    const article = articleFixture({
      brief: {
        oneSentence: "旧解释",
        concepts: ["概念"],
        prerequisites: [],
        misconceptions: [],
        analogies: [],
        unsupportedNotes: []
      },
      outline: [{ id: "one", title: "第一章", order: 0 }],
      status: "brief_ready"
    });
    render(
      <ArticleWorkspace
        initialArticle={article}
        initialSources={[]}
        initialStep="sources"
        saveArticle={saveArticle}
        autosaveDelayMs={0}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑知识梳理" }));
    await userEvent.clear(screen.getByLabelText("一句话解释"));
    await userEvent.type(screen.getByLabelText("一句话解释"), "新解释");
    await waitFor(() => expect(saveArticle).toHaveBeenCalled());
    const latest = saveArticle.mock.calls.at(-1)?.[0];
    expect(latest.status).toBe("brief_ready");
    expect(latest.outlineConfirmedAt).toBeNull();
  });

  it("serializes autosaves without replacing edits made during a request", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstSave!: (result: {
        kind: "saved";
        article: ReturnType<typeof articleFixture>;
      }) => void;
      const firstSave = new Promise<{
        kind: "saved";
        article: ReturnType<typeof articleFixture>;
      }>((resolve) => {
        resolveFirstSave = resolve;
      });
      const saveArticle = vi
        .fn()
        .mockImplementationOnce(() => firstSave)
        .mockImplementation(async (article) => ({
          kind: "saved" as const,
          article: { ...article, updatedAt: "2026-09-09T00:00:03.000Z" }
        }));
      const initialArticle = currentArticleDraft();
      render(
        <ArticleWorkspace
          initialArticle={initialArticle}
          saveArticle={saveArticle}
          autosaveDelayMs={1}
        />
      );

      const paragraph = screen.getByLabelText("正文块 1");
      fireEvent.change(paragraph, { target: { value: "第一次编辑" } });
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(saveArticle).toHaveBeenCalledTimes(1);

      fireEvent.change(paragraph, { target: { value: "请求中的新编辑" } });
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(saveArticle).toHaveBeenCalledTimes(1);

      const firstArticle = saveArticle.mock.calls[0][0];
      await act(async () => {
        resolveFirstSave({
          kind: "saved",
          article: {
            ...firstArticle,
            updatedAt: "2026-09-09T00:00:02.000Z"
          }
        });
        await firstSave;
      });

      expect(screen.getByDisplayValue("请求中的新编辑")).toBeVisible();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(saveArticle).toHaveBeenCalledTimes(2);
      expect(saveArticle.mock.calls[1][0].blocks[0].content).toBe(
        "请求中的新编辑"
      );
      expect(saveArticle.mock.calls[1][1]).toBe(
        "2026-09-09T00:00:02.000Z"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the updated article version after image planning without scheduling an old autosave", async () => {
    vi.useFakeTimers();
    try {
      const article = currentArticleDraft();
      const saveArticle = vi.fn(async (saved) => ({ kind: "saved" as const, article: saved }));
      const planned = { ...article, updatedAt: "2026-09-09T00:00:07.000Z" };
      render(
        <ArticleWorkspace
          initialArticle={article}
          initialImageAssets={[]}
          saveArticle={saveArticle}
          planImages={async () => ({ article: planned, assets: [imageAsset] })}
          autosaveDelayMs={1}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "分析配图需求" }));
      await act(async () => undefined);
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(screen.getByRole("img", { name: "概念图" })).toBeVisible();
      expect(saveArticle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unsaved body edits by blocking image planning until the article is saved", async () => {
    const article = currentArticleDraft();
    const planned = {
      ...article,
      blocks: article.blocks.map((block) => ({ ...block, content: "服务端旧正文" })),
      updatedAt: "2026-09-09T00:00:08.000Z"
    };
    const planImages = vi.fn(async () => ({ article: planned, assets: [imageAsset] }));
    render(
      <ArticleWorkspace
        initialArticle={article}
        initialImageAssets={[]}
        planImages={planImages}
        autosaveDelayMs={60_000}
      />
    );

    fireEvent.change(screen.getByLabelText("正文块 1"), { target: { value: "本地未保存正文" } });

    const planButton = screen.getByRole("button", { name: "分析配图需求" });
    expect(planButton).toBeDisabled();
    expect(screen.getByText("正在保存文章，保存完成后可操作配图")).toBeVisible();
    fireEvent.click(planButton);

    expect(planImages).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("本地未保存正文")).toBeVisible();
    expect(screen.queryByText("服务端旧正文")).not.toBeInTheDocument();
  });

  it("keeps body edits made while image planning is pending", async () => {
    let resolvePlan!: (result: { article: ReturnType<typeof articleFixture>; assets: ImageAsset[] }) => void;
    const pendingPlan = new Promise<{ article: ReturnType<typeof articleFixture>; assets: ImageAsset[] }>(
      (resolve) => {
        resolvePlan = resolve;
      }
    );
    const article = currentArticleDraft();
    const planImages = vi.fn(() => pendingPlan);
    render(
      <ArticleWorkspace
        initialArticle={article}
        initialImageAssets={[]}
        planImages={planImages}
        autosaveDelayMs={60_000}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "分析配图需求" }));
    await waitFor(() => expect(planImages).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("正文块 1"), { target: { value: "规划期间的新正文" } });

    await act(async () => {
      resolvePlan({
        article: {
          ...article,
          blocks: article.blocks.map((block) => ({ ...block, content: "过期服务端正文" })),
          updatedAt: "2026-09-09T00:00:09.000Z"
        },
        assets: [imageAsset]
      });
      await pendingPlan;
    });

    expect(screen.getByDisplayValue("规划期间的新正文")).toBeVisible();
    expect(screen.getByRole("button", { name: "分析配图需求" })).toBeDisabled();
    expect(screen.queryByRole("img", { name: "概念图" })).not.toBeInTheDocument();
    expect(screen.getByText("文章已发生新编辑，请保存后刷新配图结果")).toBeVisible();
    expect(localStorage.getItem("article-draft:article-1")).toContain("规划期间的新正文");
  });

  it("keeps body edits made while an image asset mutation is pending", async () => {
    let resolveUpdate!: (result: { article: ReturnType<typeof articleFixture>; assets: ImageAsset[] }) => void;
    const pendingUpdate = new Promise<{ article: ReturnType<typeof articleFixture>; assets: ImageAsset[] }>(
      (resolve) => {
        resolveUpdate = resolve;
      }
    );
    const article = currentArticleDraft();
    const updateImageAsset = vi.fn(() => pendingUpdate);
    render(
      <ArticleWorkspace
        initialArticle={article}
        initialImageAssets={[imageAsset]}
        updateImageAsset={updateImageAsset}
        autosaveDelayMs={60_000}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "启用配图 1" }));
    await waitFor(() => expect(updateImageAsset).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("正文块 1"), { target: { value: "资产请求期间的新正文" } });

    await act(async () => {
      resolveUpdate({
        article: {
          ...article,
          blocks: article.blocks.map((block) => ({ ...block, content: "过期服务端正文" })),
          updatedAt: "2026-09-09T00:00:10.000Z"
        },
        assets: [{ ...imageAsset, status: "disabled" }]
      });
      await pendingUpdate;
    });

    expect(screen.getByLabelText("正文块 1")).toHaveValue("资产请求期间的新正文");
    expect(screen.getByText("待生成")).toBeVisible();
    expect(screen.queryByText("已停用")).not.toBeInTheDocument();
    expect(screen.getByText("文章已发生新编辑，请保存后刷新配图结果")).toBeVisible();
  });

  it("keeps a conflicting autosave dirty and locks image planning", async () => {
    render(
      <ArticleWorkspace
        initialArticle={currentArticleDraft()}
        saveArticle={async () => ({ kind: "conflict" })}
        autosaveDelayMs={0}
      />
    );

    fireEvent.change(screen.getByLabelText("正文块 1"), { target: { value: "冲突本地正文" } });

    await waitFor(() => expect(screen.getByText(/文章已在其他位置更新/)).toBeVisible());
    expect(screen.getByDisplayValue("冲突本地正文")).toBeVisible();
    expect(screen.getByRole("button", { name: "分析配图需求" })).toBeDisabled();
    expect(localStorage.getItem("article-draft:article-1")).toContain("冲突本地正文");
  });

  it("keeps a failed autosave dirty and locks image planning", async () => {
    render(
      <ArticleWorkspace
        initialArticle={currentArticleDraft()}
        saveArticle={async () => {
          throw new Error("offline");
        }}
        autosaveDelayMs={0}
      />
    );

    fireEvent.change(screen.getByLabelText("正文块 1"), { target: { value: "失败本地正文" } });

    await waitFor(() => expect(screen.getByText("保存失败，本地修改已暂存")).toBeVisible());
    expect(screen.getByDisplayValue("失败本地正文")).toBeVisible();
    expect(screen.getByRole("button", { name: "分析配图需求" })).toBeDisabled();
    expect(localStorage.getItem("article-draft:article-1")).toContain("失败本地正文");
  });
});
