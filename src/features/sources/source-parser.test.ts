import { describe, expect, it } from "vitest";
import { parseSource } from "./source-parser";

describe("parseSource", () => {
  it("trims supported text while keeping Markdown content", () => {
    expect(
      parseSource({ type: "markdown", content: "  # 标题\n\n正文  " })
    ).toEqual({ status: "ready", content: "# 标题\n\n正文" });
  });

  it("marks web, PDF and DOCX sources as unsupported", () => {
    expect(parseSource({ type: "pdf", content: "二进制占位" })).toEqual({
      status: "unsupported",
      content: "二进制占位"
    });
  });
});
