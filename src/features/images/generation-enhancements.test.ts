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
    expect(composeEnhancedPrompt("画一只蘑菇", { promptPrefix: "", referenceImages: [] })).toBe("画一只蘑菇");
    expect(referenceImagesField({ promptPrefix: "", referenceImages: [] })).toEqual({});
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
    expect(recorder.inputs[0]!.prompt.endsWith("画一只蘑菇")).toBe(true);
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
        { promptPrefix: "", referenceImages: [] }
      )
    ).rejects.toBe(blocked);
    // 没有可剥离的附加文本，重试是同一份请求，只会翻倍失败。
    expect(recorder.inputs).toHaveLength(1);
  });
});
