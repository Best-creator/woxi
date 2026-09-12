export type LlmErrorCode =
  | "timeout"
  | "authentication"
  | "invalid_response"
  | "upstream"
  | "model_not_allowed";

export class LlmError extends Error {
  constructor(public readonly code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
  }
}
