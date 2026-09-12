import type { SourceDocument, SourceType } from "./domain";

export interface CreateSourceInput {
  articleId: string;
  title: string;
  type: SourceType;
  content: string;
}

export interface SourceRepository {
  list(articleId: string): Promise<SourceDocument[]>;
  findById(articleId: string, sourceId: string): Promise<SourceDocument | null>;
  create(input: CreateSourceInput): Promise<SourceDocument>;
  updateEnabled(
    articleId: string,
    sourceId: string,
    enabled: boolean
  ): Promise<SourceDocument | null>;
  remove(articleId: string, sourceId: string): Promise<boolean>;
}
