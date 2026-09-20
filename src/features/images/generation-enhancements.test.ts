// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  composeEnhancedPrompt,
  generateWithEnhancementFallback,
  referenceImagesField,
  type GenerationEnhancements
} from "./generation-enhancements";
import { ImageGeneratorError } from "./image-generator";
import type { GeneratedImagePayload, ImageGeneratorInput } from "./image-generator";

const payload: GeneratedImagePayload = { remoteUrl: "https://cdn.example.test/a.png", binary: null, format: "png" };

const enhanced: GenerationEnhancements = {
  styleText: "扁平插画，暖色调",
  promptPrefix: "【绘制风格】扁平插画，暖色调",
  referenceImages: [{ data: Buffer.from("ref"), mimeType: "image/png" }]
};

/** 记录每次上游输入的生成器；outcomes 逐次消费，最后一项会一直复用。 */
function recordingGenerator(outcomes: Array<GeneratedImagePayload | Error>) {
  const inputs: ImageGeneratorInput[] = [];
  const generator = {
    generate: async (input: ImageGeneratorInput): Promise<GeneratedImagePayload> => {
      inputs.push(input);
      const outcome = outcomes[Math.min(inputs.length - 1, outcomes.length - 1)]!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
  };
  return { generator, inputs };
}

describe("composeEnhancedPrompt / referenceImagesField", () => {
  it("returns the asset prompt untouched when there is no enhancement prefix", () => {
    expect(composeEnhancedPrompt("画一只蘑菇", { styleText: "", promptPrefix: "", referenceImages: [] })).toBe(
      "画一只蘑菇"
    );
    expect(referenceImagesField({ styleText: "", promptPrefix: "", referenceImages: [] })).toEqual({});
  });

  it("只有参考形象、没有画风时，不加「画风优先」这句多余的约束", () => {
    const prompt = composeEnhancedPrompt("画一只蘑菇", {
      styleText: "",
      promptPrefix: "【参考形象】蘑菇老师",
      referenceImages: []
    });
    expect(prompt).toBe("【参考形象】蘑菇老师\n\n画一只蘑菇");
  });

  it("把画风引导放在帧描述之前、画风优先放在最后", () => {
    // 真实故障：帧描述里写死了「日系动漫画风，赛璐璐上色」，出图完全听它，所选画风一点没落地。
    const prompt = composeEnhancedPrompt("三只柴犬办案。日系动漫画风，赛璐璐上色，纯白背景。", {
      styleText: "白底粗线手绘条漫",
      promptPrefix: "【绘制风格】白底粗线手绘条漫",
      referenceImages: []
    });

    expect(prompt).toContain("【绘制风格】白底粗线手绘条漫");
    expect(prompt.indexOf("【绘制风格】")).toBeLessThan(prompt.indexOf("三只柴犬办案"));
    // 收尾指令在最后（最后一句权重最大），点名忽略帧描述里的画风词。
    expect(prompt.trimEnd().endsWith("不得套用。")).toBe(true);
    expect(prompt).toContain("画风、媒介与技法词");
  });
});

describe("generateWithEnhancementFallback", () => {
  it("sends the enhanced prompt with the reference images and the chosen model", async () => {
    const recorder = recordingGenerator([payload]);

    const result = await generateWithEnhancementFallback(
      recorder.generator,
      { prompt: "画一只蘑菇", aspectRatio: "portrait" },
      enhanced,
      "mirror-image-model"
    );

    expect(result).toBe(payload);
    expect(recorder.inputs).toHaveLength(1);
    expect(recorder.inputs[0]).toMatchObject({ aspectRatio: "portrait", model: "mirror-image-model" });
    expect(recorder.inputs[0]!.prompt).toContain("【绘制风格】扁平插画，暖色调");
    expect(recorder.inputs[0]!.prompt).toContain("画一只蘑菇");
    // 末尾必须有「画风优先」：帧描述自带的画风词要让位给注入的画风（真实踩过的坑）。
    expect(recorder.inputs[0]!.prompt).toContain("【画风优先】");
    expect(recorder.inputs[0]!.referenceImages).toHaveLength(1);
  });

  it("retries with the raw prompt when the upstream blocks the enhanced one", async () => {
    // 真实故障形态：画风引导触发的整批拦截 → 剥掉引导文本后单帧能过。
    const recorder = recordingGenerator([
      new ImageGeneratorError("content_blocked", "画面描述被上游内容策略拦截。"),
      payload
    ]);

    const result = await generateWithEnhancementFallback(
      recorder.generator,
      { prompt: "画一只蘑菇", aspectRatio: "square" },
      enhanced,
      "test-image-model"
    );

    expect(result).toBe(payload);
    expect(recorder.inputs).toHaveLength(2);
    // 第二次只发设计稿原文，参考图/尺寸/模型照旧保留（它们是相似度的实质收益）。
    expect(recorder.inputs[1]).toMatchObject({
      prompt: "画一只蘑菇",
      aspectRatio: "square",
      model: "test-image-model"
    });
    expect(recorder.inputs[1]!.referenceImages).toHaveLength(1);
  });

  it("单格分镜帧额外压住「画像里的整页排版」，封面不压", async () => {
    // 画风画像里「居中章节标题 / 橙色对话框 / 圆形旁白头像」是整页条漫的排版；
    // 单格帧的文字由渲染器烘（实测不压住时模型会自己画气泡和标牌，与台词条重复）。
    const withStyle: GenerationEnhancements = {
      styleText: "白底粗线手绘条漫",
      promptPrefix: "【绘制风格】白底粗线手绘条漫",
      referenceImages: []
    };
    const recorder = recordingGenerator([payload, payload]);

    await generateWithEnhancementFallback(
      recorder.generator,
      { prompt: "三只柴犬办案", aspectRatio: "square", type: "storyboard" },
      withStyle
    );
    await generateWithEnhancementFallback(
      recorder.generator,
      { prompt: "封面主视觉", aspectRatio: "cover", type: "cover" },
      withStyle
    );

    expect(recorder.inputs[0]!.prompt).toContain("【不画文字】");
    expect(recorder.inputs[1]!.prompt).not.toContain("【不画文字】");
  });

  it("净化掉两条分支里的平台词（它们正是上游拦人的原因）", async () => {
    const platformStyled: GenerationEnhancements = {
      styleText: "中国微信知识号手绘条漫画风，微信竖向长图。",
      promptPrefix: "【绘制风格】中国微信知识号手绘条漫画风，微信竖向长图。",
      referenceImages: []
    };
    const recorder = recordingGenerator([
      new ImageGeneratorError("content_blocked", "画面描述被上游内容策略拦截。"),
      payload
    ]);

    await generateWithEnhancementFallback(
      recorder.generator,
      { prompt: "适合公众号阅读的螺蛳粉摊", aspectRatio: "square" },
      platformStyled
    );

    // 增强分支与降级分支都不能带走平台词；画风与画面信息要留住。
    for (const input of recorder.inputs) {
      expect(input.prompt).not.toMatch(/微信|公众号|知识号/);
    }
    expect(recorder.inputs[0]!.prompt).toContain("中国科普知识手绘条漫画风");
    expect(recorder.inputs[1]!.prompt).toBe("适合知识图文阅读的螺蛳粉摊");
  });

  it("does not retry when the failure is not a content block", async () => {
    const blocked = new ImageGeneratorError("upstream", "图片生成服务返回错误。");
    const recorder = recordingGenerator([blocked]);

    await expect(
      generateWithEnhancementFallback(
        recorder.generator,
        { prompt: "画一只蘑菇", aspectRatio: "square" },
        enhanced
      )
    ).rejects.toBe(blocked);
    // 上游抖动/配置错不是「提示词有问题」，重试只是白烧一次配额。
    expect(recorder.inputs).toHaveLength(1);
  });

  it("does not retry when nothing was prepended in the first place", async () => {
    const blocked = new ImageGeneratorError("content_blocked", "画面描述被上游内容策略拦截。");
    const recorder = recordingGenerator([blocked]);

    await expect(
      generateWithEnhancementFallback(
        recorder.generator,
        { prompt: "画一只蘑菇", aspectRatio: "square" },
        { styleText: "", promptPrefix: "", referenceImages: [] }
      )
    ).rejects.toBe(blocked);
    // 没有可剥离的附加文本，重试是同一份请求，只会翻倍失败。
    expect(recorder.inputs).toHaveLength(1);
  });
});
