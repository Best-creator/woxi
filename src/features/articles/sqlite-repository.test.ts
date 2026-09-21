// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { outlineSectionSchema } from "./schemas";
import { resolveStyleProfile } from "@/features/content/style-profile";
import { migrateDatabase } from "@/server/db";
import { paragraphBlock } from "../../../tests/fixtures/article";
import { createTestRepository } from "../../../tests/helpers/test-db";
import { SqliteArticleRepository } from "./sqlite-repository";

describe("SqliteArticleRepository", () => {
  it("creates and lists articles newest first", async () => {
    const repository = createTestRepository();
    const first = await repository.create({ topic: "什么是机会成本" });
    const second = await repository.create({ topic: "为什么天空是蓝色" });

    expect(first.title).toBe("什么是机会成本");
    expect(first.planning).toEqual({
      lengthPreset: "brief",
      recommendedTotalWords: null,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    });
    expect((await repository.list()).map((item) => item.id)).toEqual([
      second.id,
      first.id
    ]);
  });

  it("round-trips structured blocks", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });
    article.blocks = [paragraphBlock("越早开始，时间越能放大积累。")];

    const saved = await repository.save(article, article.updatedAt);

    expect(saved.kind).toBe("saved");
    expect((await repository.findById(article.id))?.blocks).toEqual(
      article.blocks
    );
  });

  it("round-trips article planning and enriched outline sections", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "机会成本" });

    const saved = await repository.save(
      {
        ...article,
        outline: [
          {
            id: "section-1",
            title: "先说选择",
            goal: "从生活选择建立直觉",
            recommendedWords: 280,
            order: 0
          }
        ],
        planning: {
          lengthPreset: "standard",
          recommendedTotalWords: 1200,
          confirmedOutlineRevisionId: null,
          contentOutlineRevisionId: null
        }
      },
      article.updatedAt
    );

    expect(saved).toMatchObject({
      kind: "saved",
      article: {
        planning: { recommendedTotalWords: 1200 },
        outline: [
          {
            goal: "从生活选择建立直觉",
            recommendedWords: 280
          }
        ]
      }
    });
    expect((await repository.findById(article.id))?.planning).toEqual({
      lengthPreset: "standard",
      recommendedTotalWords: 1200,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    });
  });

  it("uses default planning when reading an article from before the migration", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE articles (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, status TEXT NOT NULL,
        brief_json TEXT, outline_json TEXT NOT NULL, blocks_json TEXT NOT NULL,
        outline_confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO articles (
        id, title, topic, status, brief_json, outline_json, blocks_json,
        outline_confirmed_at, created_at, updated_at
      ) VALUES (
        'legacy-article', '旧文章', '旧主题', 'draft', NULL, '[]', '[]', NULL,
        '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'
      );
    `);
    migrateDatabase(db);
    migrateDatabase(db);

    const article = await new SqliteArticleRepository(db).findById("legacy-article");

    expect(article?.planning).toEqual({
      // 默认档位 = 轻量（brief）：剧情漫画的体量预期是十段左右，见 DEFAULT_ARTICLE_PLANNING。
      lengthPreset: "brief",
      recommendedTotalWords: null,
      confirmedOutlineRevisionId: null,
      contentOutlineRevisionId: null
    });
    expect(article?.styleProfile).toMatchObject({
      preset: "popular_science_teacher",
      tone: "亲切、自然、有耐心"
    });
  });

  it("round-trips a custom style profile", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });
    const styleProfile = resolveStyleProfile("friend_chat", "少用反问句，多用具体数字");

    const saved = await repository.save({ ...article, styleProfile }, article.updatedAt);

    expect(saved.kind).toBe("saved");
    expect((await repository.findById(article.id))?.styleProfile).toEqual(styleProfile);
  });

  it("validates optional outline goals and recommended word counts", () => {
    expect(
      outlineSectionSchema.parse({
        id: "section-1",
        title: "先说选择",
        goal: "从生活选择建立直觉",
        recommendedWords: 280,
        order: 0
      })
    ).toMatchObject({
      goal: "从生活选择建立直觉",
      recommendedWords: 280
    });
    expect(() =>
      outlineSectionSchema.parse({
        id: "section-1",
        title: "先说选择",
        goal: "a".repeat(501),
        order: 0
      })
    ).toThrow();
    expect(() =>
      outlineSectionSchema.parse({
        id: "section-1",
        title: "先说选择",
        recommendedWords: 49.5,
        order: 0
      })
    ).toThrow();
  });

  it("rejects a stale save without overwriting newer content", async () => {
    const repository = createTestRepository();
    const article = await repository.create({ topic: "复利" });
    const staleVersion = article.updatedAt;

    article.title = "第一次修改";
    const firstSave = await repository.save(article, staleVersion);
    expect(firstSave.kind).toBe("saved");

    article.title = "过期修改";
    const staleSave = await repository.save(article, staleVersion);

    expect(staleSave).toEqual({ kind: "conflict" });
    expect((await repository.findById(article.id))?.title).toBe("第一次修改");
  });
});
