export type ResearchErrorCode =
  | "search_unavailable"
  | "llm_error"
  | "not_found"
  | "conflict";

export class ResearchError extends Error {
  readonly code: ResearchErrorCode;

  constructor(code: ResearchErrorCode, message: string) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
  }
}
