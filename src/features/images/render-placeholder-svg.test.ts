import { describe, expect, it } from "vitest";
import { renderPlaceholderSvg } from "./render-placeholder-svg";

describe("renderPlaceholderSvg", () => {
  it.each([
    ["cover", "900 383"],
    ["landscape", "1200 800"],
    ["square", "1000 1000"],
    ["portrait", "900 1200"]
  ] as const)("uses the fixed %s canvas", (aspectRatio, viewBox) => {
    const svg = renderPlaceholderSvg({ aspectRatio, altText: "复利示意图", purpose: "解释复利" });

    expect(svg).toContain(`viewBox="0 0 ${viewBox}"`);
  });

  it("escapes untrusted text and retains accessible placeholder text", () => {
    const svg = renderPlaceholderSvg({
      aspectRatio: "landscape",
      altText: '<script>alert("x")</script> & "引用"',
      purpose: "& <script>不应执行</script>"
    });

    expect(svg).toContain("待生成");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;引用&quot;");
    expect(svg).not.toContain("<script>");
  });

  it("limits long text to four lines", () => {
    const svg = renderPlaceholderSvg({
      aspectRatio: "square",
      altText: "这是一段需要被拆分为有限行数的非常长的替代文本以确保图片占位内容不会溢出画布边界".repeat(10),
      purpose: "解释"
    });

    expect((svg.match(/<tspan /g) ?? [])).toHaveLength(4);
  });

  it("places four description lines below the label and inside the compact cover canvas", () => {
    const svg = renderPlaceholderSvg({
      aspectRatio: "cover",
      altText: "说明文本".repeat(100),
      purpose: "解释"
    });
    const label = svg.match(/<text[^>]* y="([\d.]+)"[^>]*font-size="28"[^>]*>待生成/);
    const description = svg.match(/<text[^>]* y="([\d.]+)"[^>]*font-size="22"[^>]*><tspan/);
    if (!label || !description) throw new Error("placeholder text baselines should be present");
    const labelBaseline = Number(label[1]);
    const firstLineBaseline = Number(description[1]);
    const lastLineBaseline = firstLineBaseline + 3 * 34;

    expect(firstLineBaseline).toBeGreaterThanOrEqual(labelBaseline + 34);
    expect(lastLineBaseline).toBeLessThan(383);
  });
});
