import type { Article } from "./domain";

export type SaveArticleResult =
  | { kind: "saved"; article: Article }
  | { kind: "conflict" };

export interface ArticleRepository {
  list(): Promise<Article[]>;
  findById(id: string): Promise<Article | null>;
  create(input: { topic: string; title?: string }): Promise<Article>;
  save(article: Article, expectedUpdatedAt: string): Promise<SaveArticleResult>;
}

