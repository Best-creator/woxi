export type SourceType = "text" | "markdown" | "web" | "pdf" | "docx";

export type SourceStatus = "ready" | "pending" | "unsupported" | "failed";

export interface SourceDocument {
  id: string;
  articleId: string;
  title: string;
  type: SourceType;
  content: string;
  status: SourceStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
