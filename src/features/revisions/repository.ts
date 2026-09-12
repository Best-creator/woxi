import type {
  ArticleReview,
  ArticleRevision,
  CreateRevisionInput,
  RevisionScope
} from "./domain";

export type CreateRevisionResult<TSnapshot> =
  | { revision: ArticleRevision<TSnapshot>; created: boolean }
  | { kind: "conflict" };

export interface SaveReviewInput<TResult> {
  revisionId: string;
  model: string;
  result: TResult;
}

export interface RevisionRepository {
  createIfChanged<TSnapshot>(
    input: CreateRevisionInput<TSnapshot>
  ): Promise<CreateRevisionResult<TSnapshot>>;
  list<TSnapshot>(
    articleId: string,
    scope: RevisionScope
  ): Promise<ArticleRevision<TSnapshot>[]>;
  findById<TSnapshot>(id: string): Promise<ArticleRevision<TSnapshot> | null>;
  saveReview<TResult>(input: SaveReviewInput<TResult>): Promise<ArticleReview<TResult>>;
  latestReview<TResult>(revisionId: string): Promise<ArticleReview<TResult> | null>;
}
