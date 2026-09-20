// @vitest-environment node

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { ImagePlanSuggestion } from "./domain";
import { generateImageAssetsBatch } from "./generate-image-assets-batch";
import { ImageGeneratorError } from "./image-generator";
import type { GeneratedImagePayload, ImageGeneratorInput } from "./image-generator";
import type { ImageAssetRepository } from "./repository";
import { SqliteImageAssetRepository } from "./sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

const cover: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "封面",
  prompt: "封面提示词",
  altText: "封面",
  aspectRatio: "cover"
};

function suggestionWith(prompt: string): ImagePlanSuggestion {
  return { ...cover, prompt };
}

function payloadWith(prompt: string): GeneratedImagePayload {
  return { remoteUrl: `https://cdn.example.test/${encodeURIComponent(prompt)}.png`, binary: Buffer.from(`img-${prompt}`), format: "png" };
}

type DeferredOutcome = GeneratedImagePayload | Error;

/**
 * 可手动放行的生成器：记录「已发起」的调用数，用来断言上游是并行发起的
 * （全部 fire 之后才逐个放行，而不是串行等上一张完成）。
 */
function deferredGenerator(outcomes: DeferredOutcome[]) {
  const pending: Array<() => void> = [];
  let fired = 0;
  let index = 0;
  return {
    generator: {
      generate: (): Promise<GeneratedImagePayload> => {
        fired += 1;
        const outcome = outcomes[index]!;
        index += 1;
        return new Promise((resolve, reject) => {
          pending.push(() => (outcome instanceof Error ? reject(outcome) : resolve(outcome)));
        });
      }
    },
    firedCount: () => fired,
    releaseOne: () => pending.shift()?.(),
    releaseAll: () => {
      while (pending.length) pending.shift()?.();
    }
  };
}

async function createPlannedFixture(assetCount: number) {
  const db = createTestDatabase();
  const articlesRepo = new SqliteArticleRepository(db);
  const created = await articlesRepo.create({ topic: "机会成本" });
  const imagesRepo: ImageAssetRepository = new SqliteImageAssetRepository(db);
  const plan = await imagesRepo.applyPlan(
    created.id,
    created.updatedAt,
    Array.from({ length: assetCount }, (_, i) => suggestionWith(`提示词-${i + 1}`))
  );
  if (plan.kind !== "saved") throw new Error("plan should save");
  return {
    imagesRepo,
    articleId: created.id,
    assetIds: plan.assets.map((asset) => asset.id),
    expectedUpdatedAt: plan.article.updatedAt
  };
}

function waitTick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("generateImageAssetsBatch", () => {
  it("fires every upstream call before the first one completes (parallel, not serial)", async () => {
    const fixture = await createPlannedFixture(3);
    const deferred = deferredGenerator([payloadWith("a"), payloadWith("b"), payloadWith("c")]);

    const running = generateImageAssetsBatch(fixture, { images: fixture.imagesRepo, generator: deferred.generator });
    await waitTick();
    // 关键断言：一张都还没放行，三个上游调用都已经发起——这就是并行。
    expect(deferred.firedCount()).toBe(3);
    deferred.releaseAll();

    const result = await running;
    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    const statuses = result.assets.map((asset) => asset.status);
    expect(statuses).toEqual(["generated", "generated", "generated"]);
  });

  it("keeps succeeded versions and marks the rejected one failed", async () => {
    const fixture = await createPlannedFixture(3);
    const deferred = deferredGenerator([payloadWith("ok-1"), new Error("upstream boom"), payloadWith("ok-3")]);

    const running = generateImageAssetsBatch(fixture, { images: fixture.imagesRepo, generator: deferred.generator });
    await waitTick();
    deferred.releaseAll();
    const result = await running;

    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    const failedEntry = result.results.find((item) => !item.ok);
    expect(failedEntry?.message).toBe("图片生成失败，请稍后重试");
    const failedAsset = await fixture.imagesRepo.findById(fixture.articleId, fixture.assetIds[1]!);
    expect(failedAsset?.status).toBe("failed");
    const okAsset = await fixture.imagesRepo.findById(fixture.articleId, fixture.assetIds[0]!);
    expect(okAsset?.status).toBe("generated");
  });

  it("propagates a stale version as conflict without calling the generator", async () => {
    const fixture = await createPlannedFixture(2);
    const deferred = deferredGenerator([payloadWith("x"), payloadWith("y")]);

    const result = await generateImageAssetsBatch(
      { ...fixture, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
      { images: fixture.imagesRepo, generator: deferred.generator }
    );

    expect(result).toEqual({ kind: "conflict" });
    expect(deferred.firedCount()).toBe(0);
  });

  it("returns nothing_pending when every asset is already generated", async () => {
    const fixture = await createPlannedFixture(1);
    const first = await generateImageAssetsBatch(fixture, {
      images: fixture.imagesRepo,
      generator: { generate: () => Promise.resolve(payloadWith("done")) }
    });
    if (first.kind !== "saved") throw new Error(`expected saved, got ${first.kind}`);

    const second = await generateImageAssetsBatch(
      { ...fixture, expectedUpdatedAt: first.article.updatedAt },
      { images: fixture.imagesRepo, generator: { generate: () => Promise.resolve(payloadWith("again")) } }
    );
    expect(second).toEqual({ kind: "nothing_pending" });
  });

  it("aborts persistence on conflict and leaves no orphan files behind", async () => {
    const fixture = await createPlannedFixture(2);
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-batch-"));
    const deferred = deferredGenerator([payloadWith("a"), payloadWith("b")]);

    // 用 Proxy 只拦截 completeGeneration：落库阶段必然撞锁。
    const lockedRepo = new Proxy(fixture.imagesRepo, {
      get(target, property, receiver) {
        if (property === "completeGeneration") {
          return async () => ({ kind: "conflict" as const });
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as ImageAssetRepository;

    const running = generateImageAssetsBatch(fixture, { images: lockedRepo, generator: deferred.generator, storageDir });
    await waitTick();
    deferred.releaseAll();
    const result = await running;

    // 一张都没落成 → 整体 conflict；已落盘的半成品必须清掉。
    expect(result).toEqual({ kind: "conflict" });
    expect(await readdir(storageDir)).toEqual([]);
  });

  it("falls back to the raw prompt per frame when the style guide triggers a content block", async () => {
    // 真实故障：同一段画风引导前置到每一帧，上游按内容策略把整批拦掉，
    // 剥掉引导文本后设计稿原文能过——批量因此不该「一炸全炸」。
    const fixture = await createPlannedFixture(2);
    const inputs: ImageGeneratorInput[] = [];

    const result = await generateImageAssetsBatch(fixture, {
      images: fixture.imagesRepo,
      generator: {
        generate: async (input) => {
          inputs.push(input);
          if (input.prompt.includes("【绘制风格】")) {
            throw new ImageGeneratorError("content_blocked", "画面描述被上游内容策略拦截。");
          }
          return payloadWith(input.prompt);
        }
      },
      planSettings: {
        get: async () => ({ style: "扁平插画，暖色调", characterId: null }),
        set: async () => undefined
      }
    });

    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    // 2 张增强请求（被拦）+ 2 张原文请求（通过）。
    expect(inputs).toHaveLength(4);
    const rawPrompts = inputs
      .filter((input) => !input.prompt.includes("【绘制风格】"))
      .map((input) => input.prompt)
      .sort();
    expect(rawPrompts).toEqual(["提示词-1", "提示词-2"]);
  });

  it("applies the style and character enhancements to every frame in the batch", async () => {
    const fixture = await createPlannedFixture(2);
    const inputs: ImageGeneratorInput[] = [];

    const result = await generateImageAssetsBatch(fixture, {
      images: fixture.imagesRepo,
      generator: {
        generate: async (input) => {
          inputs.push(input);
          return payloadWith("ok");
        }
      },
      planSettings: {
        get: async () => ({ style: "扁平插画，暖色调", characterId: "char-1" }),
        set: async () => undefined
      },
      characters: {
        list: async () => [],
        findById: async (id: string) =>
          id === "char-1"
            ? {
                id: "char-1",
                name: "蘑菇老师",
                persona: "科普老师",
                description: "戴圆框眼镜的蘑菇头卡通形象",
                mimeType: "image/png",
                filePath: "",
                publicUrl: "/api/characters/char-1/image",
                createdAt: "2026-09-18T00:00:00.000Z",
                updatedAt: "2026-09-18T00:00:00.000Z"
              }
            : null,
        create: async () => {
          throw new Error("not used in this test");
        },
        update: async () => null,
        remove: async () => false
      }
    });

    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    expect(result.succeeded).toBe(2);
    expect(inputs).toHaveLength(2);
    // 每一帧的 prompt 都被前置了同一份画风 + 参考形象文本。
    for (const input of inputs) {
      expect(input.prompt).toContain("【绘制风格】");
      expect(input.prompt).toContain("扁平插画，暖色调");
      expect(input.prompt).toContain("【参考形象】蘑菇老师（科普老师）");
      expect(input.prompt.indexOf("【绘制风格】")).toBeLessThan(input.prompt.indexOf("提示词-"));
    }
    // 参考形象没配文件路径 → 无参考图二进制，生成输入不带 referenceImages。
    expect(inputs.every((input) => input.referenceImages === undefined)).toBe(true);
  });
});
