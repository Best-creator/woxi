// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createTestDatabase, createTestRepository } from "../../../tests/helpers/test-db";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import { SqliteSourceRepository } from "@/features/sources/sqlite-repository";
import { DemoContentGenerator } from "./demo-generator";
import { generateFoundation } from "./generate-foundation";
import type { KnowledgeBrief, OutlineSection } from "@/features/articles/domain";
import type { ContentGenerator } from "./content-generator";

const brief: KnowledgeBrief = {
  oneSentence: "复利让积累随着时间放大。",
  concepts: ["本金", "收益"],
  prerequisites: [],
  misconceptions: ["只要收益率高就一定更好"],
  analogies: ["滚雪球"],
  unsupportedNotes: []
};

const outline: OutlineSection[] = [
  { id: "intuition", title: "先理解积累", goal: "建立直觉", recommendedWords: 500, order: 0 },
  { id: "mechanism", title: "收益如何叠加", goal: "解释机制", recommendedWords: 700, order: 1 }
];

const generated = {
  title: "复利的积累逻辑",
  blocks: [
    { id: "title", type: "heading" as const, content: "复利的积累逻辑", level: 1 as const, order: 0, version: 1 },
    { id: "section-1", type: "heading" as const, content: "先理解积累", level: 2 as const, order: 1, version: 1 },
    { id: "paragraph-1", type: "paragraph" as const, content: "每一次收益都会加入下一次计算。", order: 2, version: 1 },
    { id: "section-2", type: "heading" as const, content: "收益如何叠加", level: 2 as const, order: 3, version: 1 },
    { id: "paragraph-2", type: "paragraph" as const, content: "时间越长，新增收益参与计算的轮次越多。", order: 4, version: 1 }
  ]
};

async function saveConfirmedArticle(repository: ReturnType<typeof createTestRepository>) {
  const article = await repository.create({ topic: "复利" });
  const saved = await repository.save(
    {
      ...article,
      brief,
      outline,
      status: "outline_ready",
      planning: {
        ...article.planning,
        lengthPreset: "deep",
        recommendedTotalWords: 1800,
        confirmedOutlineRevisionId: "confirmed-revision"
      },
      outlineConfirmedAt: "2026-09-10T00:00:00.000Z"
    },
    article.updatedAt
  );
  if (saved.kind !== "saved") throw new Error("fixture should save");
  return saved.article;
}

describe("generateFoundation", () => {
  it("passes the confirmed article snapshot and selected model to the content generator", async () => {
    const repository = createTestRepository();
    const article = await saveConfirmedArticle(repository);
    const generate = vi.fn().mockResolvedValue(generated);
    const generator = { generate };

    const result = await generateFoundation(
      article.id,
      article.updatedAt,
      repository,
      generator as unknown as ContentGenerator,
      undefined,
      "writer-pro"
    );

    expect(result.kind).toBe("generated");
    if (result.kind === "generated") {
      expect(result.article.status).toBe("editing");
      expect(result.article.title).toBe(generated.title);
      expect(result.article.blocks).toEqual(generated.blocks);
      expect(result.article.brief).toEqual(brief);
      expect(result.article.outline).toEqual(outline);
      expect(result.article.planning).toEqual({
        ...article.planning,
        contentOutlineRevisionId: article.planning.confirmedOutlineRevisionId
      });
      expect(result.article.outlineConfirmedAt).toBe(article.outlineConfirmedAt);
    }
    expect(generate).toHaveBeenCalledWith({
      topic: "复利",
      brief,
      outline,
      lengthPreset: "deep",
      model: "writer-pro"
    });
  });

  it("passes only enabled ready sources into generation", async () => {
    const db = createTestDatabase();
    const repository = new SqliteArticleRepository(db);
    const sourceRepository = new SqliteSourceRepository(db);
    const created = await repository.create({ topic: "复利" });
    const saved = await repository.save(
      {
        ...created,
        brief,
        outline,
        status: "outline_ready",
        planning: {
          ...created.planning,
          recommendedTotalWords: 1200,
          confirmedOutlineRevisionId: "confirmed-revision"
        },
        outlineConfirmedAt: "2026-09-10T00:00:00.000Z"
      },
      created.updatedAt
    );
    if (saved.kind !== "saved") throw new Error("fixture should save");
    const article = saved.article;
    await sourceRepository.create({ articleId: article.id, title: "可用资料", type: "text", content: "时间会放大积累。" });
    const disabled = await sourceRepository.create({ articleId: article.id, title: "停用资料", type: "text", content: "不应出现" });
    await sourceRepository.updateEnabled(article.id, disabled.id, false);
    await sourceRepository.create({ articleId: article.id, title: "PDF", type: "pdf", content: "也不应出现" });
    const generate = vi.fn().mockResolvedValue(generated);

    const result = await generateFoundation(
      article.id,
      article.updatedAt,
      repository,
      { generate } as unknown as ContentGenerator,
      sourceRepository
    );

    expect(result.kind).toBe("generated");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      sourceContext: "【可用资料】\n时间会放大积累。"
    }));
  });

  it("does not generate when the article has no saved brief or confirmed outline", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });
    const generate = vi.fn();

    const result = await generateFoundation(
      article.id,
      article.updatedAt,
      repository,
      { generate } as unknown as ContentGenerator
    );

    expect(result).toEqual({ kind: "not_ready" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not generate when only an outline confirmation timestamp is present", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });
    const saved = await repository.save(
      {
        ...article,
        brief,
        outline,
        status: "outline_ready",
        planning: { ...article.planning, recommendedTotalWords: 1200 },
        outlineConfirmedAt: "2026-09-10T00:00:00.000Z"
      },
      article.updatedAt
    );
    if (saved.kind !== "saved") throw new Error("fixture should save");
    const generate = vi.fn();

    const result = await generateFoundation(
      saved.article.id,
      saved.article.updatedAt,
      repository,
      { generate } as unknown as ContentGenerator
    );

    expect(result).toEqual({ kind: "not_ready" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrently edited article", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });

    const result = await generateFoundation(
      article.id,
      "2026-01-01T00:00:00.000Z",
      repository,
      new DemoContentGenerator()
    );

    expect(result).toEqual({ kind: "conflict" });
    expect((await repository.findById(article.id))?.blocks).toEqual([]);
  });

  it("reports a missing target", async () => {
    const result = await generateFoundation(
      "missing",
      "2026-01-01T00:00:00.000Z",
      createTestRepository(),
      new DemoContentGenerator()
    );

    expect(result).toEqual({ kind: "not_found" });
  });
});
