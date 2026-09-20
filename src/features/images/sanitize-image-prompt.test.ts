// @vitest-environment node

import { describe, expect, it } from "vitest";
import { sanitizeImagePrompt } from "./sanitize-image-prompt";

/** 真实的风格库画像片段（采集自公众号，会被逐帧前置进生图提示词）。 */
const REAL_STYLE_TEXT =
  "中国微信知识号手绘条漫画风。纯白底，黑色带手抖的粗细变化描边……" +
  "版式为微信竖向长图，宽固定高不限，自上而下阅读……大面积留白，场景极简到一根线。";

describe("sanitizeImagePrompt", () => {
  it("把真实风格画像里的平台词换成中性说法，画风描述本身不动", () => {
    const sanitized = sanitizeImagePrompt(REAL_STYLE_TEXT);

    expect(sanitized).not.toMatch(/微信|公众号|知识号/);
    // 画风信息必须留住：改的只是「给谁看」，不是「怎么画」。
    expect(sanitized).toContain("中国科普知识手绘条漫画风");
    expect(sanitized).toContain("手机竖向长图，宽固定高不限");
    expect(sanitized).toContain("大面积留白，场景极简到一根线");
  });

  it("清掉模型自己写进提示词的阅读场景词", () => {
    expect(sanitizeImagePrompt("清晰中文信息图，无水印，适合公众号阅读")).toBe(
      "清晰中文信息图，无水印，适合知识图文阅读"
    );
  });

  it("覆盖其余会被上游同一类策略拦掉的平台名", () => {
    const sanitized = sanitizeImagePrompt(
      "小红书笔记风 / 抖音竖屏 / 微博话题卡片 / 知乎问答 / 视频号封面 / B站封面 / wechat comic"
    );
    expect(sanitized).toBe(
      "图文社区笔记风 / 短视频竖屏 / 社交平台话题卡片 / 问答社区问答 / 短视频封面 / 视频网站封面 / mobile comic"
    );
  });

  it("没命中平台词时原样返回", () => {
    const clean =
      "中景，在木质料理台上一碗热气腾腾的柳州螺蛳粉前，三只圆滚滚的Q版柴犬正在办案。日系动漫画风，纯白背景。";
    expect(sanitizeImagePrompt(clean)).toBe(clean);
  });

  it("幂等：净化过的文本再净化不变", () => {
    const once = sanitizeImagePrompt(REAL_STYLE_TEXT);
    expect(sanitizeImagePrompt(once)).toBe(once);
  });
});
