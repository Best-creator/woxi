import type { SourceStatus, SourceType } from "./domain";

export function parseSource(input: {
  type: SourceType;
  content: string;
}): { status: SourceStatus; content: string } {
  const content = input.content.trim();
  if (input.type === "text" || input.type === "markdown") {
    return { status: "ready", content };
  }
  return { status: "unsupported", content };
}
