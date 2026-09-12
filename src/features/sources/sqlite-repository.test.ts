// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "../articles/sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";
import { SqliteSourceRepository } from "./sqlite-repository";

describe("SqliteSourceRepository", () => {
  it("keeps sources isolated by article and round-trips ready content", async () => {
    const db = createTestDatabase();
    const articleRepository = new SqliteArticleRepository(db);
    const firstArticle = await articleRepository.create({ topic: "复利" });
    const secondArticle = await articleRepository.create({ topic: "机会成本" });
    const repository = new SqliteSourceRepository(db);

    const source = await repository.create({
      articleId: firstArticle.id,
      title: "课堂笔记",
      type: "markdown",
      content: "# 复利\n时间会放大收益。"
    });

    expect(source.status).toBe("ready");
    expect((await repository.list(firstArticle.id)).map((item) => item.id)).toEqual([
      source.id
    ]);
    expect(await repository.list(secondArticle.id)).toEqual([]);
  });

  it("toggles and removes a source without touching another source", async () => {
    const db = createTestDatabase();
    const articleRepository = new SqliteArticleRepository(db);
    const article = await articleRepository.create({ topic: "复利" });
    const repository = new SqliteSourceRepository(db);
    const first = await repository.create({
      articleId: article.id,
      title: "第一份",
      type: "text",
      content: "第一段"
    });
    const second = await repository.create({
      articleId: article.id,
      title: "第二份",
      type: "pdf",
      content: "文件尚未解析"
    });

    const disabled = await repository.updateEnabled(article.id, first.id, false);
    expect(disabled?.enabled).toBe(false);
    expect((await repository.findById(article.id, second.id))?.status).toBe(
      "unsupported"
    );

    expect(await repository.remove(article.id, first.id)).toBe(true);
    expect(await repository.findById(article.id, first.id)).toBeNull();
    expect(await repository.findById(article.id, second.id)).not.toBeNull();
  });

  it("does not expose a source belonging to another article", async () => {
    const db = createTestDatabase();
    const articleRepository = new SqliteArticleRepository(db);
    const firstArticle = await articleRepository.create({ topic: "复利" });
    const secondArticle = await articleRepository.create({ topic: "机会成本" });
    const repository = new SqliteSourceRepository(db);
    const source = await repository.create({
      articleId: firstArticle.id,
      title: "第一份",
      type: "text",
      content: "第一段"
    });

    expect(await repository.findById(secondArticle.id, source.id)).toBeNull();
    expect(await repository.updateEnabled(secondArticle.id, source.id, false)).toBeNull();
    expect(await repository.remove(secondArticle.id, source.id)).toBe(false);
  });
});
