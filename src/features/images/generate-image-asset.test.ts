// @vitest-environment node

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type { ImagePlanSuggestion } from "./domain";
import { generateImageAsset } from "./generate-image-asset";
import type { GeneratedImagePayload, ImageGenerator } from "./image-generator";
import type { ImageAssetRepository } from "./repository";
import { SqliteImageAssetRepository } from "./sqlite-repository";
import { createTestDatabase } from "../../../tests/helpers/test-db";

const cover: ImagePlanSuggestion = {
  type: "cover",
  anchorBlockId: null,
  purpose: "概览文章主题",
  prompt: "机会成本的清晰中文信息图",
  altText: "机会成本概览图",
  aspectRatio: "cover"
};

function generatorReturning(payload: GeneratedImagePayload | Error): ImageGenerator {
  return {
    generate: () => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))
  };
}

async function createPlannedFixture() {
  const db = createTestDatabase();
  const articlesRepo = new SqliteArticleRepository(db);
  const created = await articlesRepo.create({ topic: "机会成本" });
  const imagesRepo: ImageAssetRepository = new SqliteImageAssetRepository(db);
  const plan = await imagesRepo.applyPlan(created.id, created.updatedAt, [cover]);
  if (plan.kind !== "saved") throw new Error("plan should save");
  return {
    imagesRepo,
    articleId: created.id,
    assetId: plan.assets[0]!.id,
    expectedUpdatedAt: plan.article.updatedAt
  };
}

describe("generateImageAsset", () => {
  it("stores the remote url and generated file, and marks the asset as generated", async () => {
    const fixture = await createPlannedFixture();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-"));
    const binary = Buffer.from("fake-png-bytes");

    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning({
        remoteUrl: "https://cdn.example.test/images/x.png",
        binary,
        format: "png"
      }),
      storageDir
    });

    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    const asset = result.assets.find((candidate) => candidate.id === fixture.assetId);
    expect(asset?.status).toBe("generated");
    expect(asset?.publicUrl).toBe("https://cdn.example.test/images/x.png");
    expect(asset?.filePath).toBeTruthy();
    const stored = await readFile(asset!.filePath!);
    expect(stored.equals(binary)).toBe(true);
  });

  it("falls back to file-only storage when the upstream returns no url", async () => {
    const fixture = await createPlannedFixture();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-"));

    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning({ remoteUrl: null, binary: Buffer.from("img"), format: "png" }),
      storageDir
    });

    if (result.kind !== "saved") throw new Error(`expected saved, got ${result.kind}`);
    const asset = result.assets.find((candidate) => candidate.id === fixture.assetId);
    expect(asset?.status).toBe("generated");
    expect(asset?.publicUrl).toBeNull();
    expect(asset?.filePath).toContain(`${fixture.assetId}-`);
    expect(asset?.filePath).toContain(".png");
  });

  it("keeps every generation on disk instead of overwriting the previous one", async () => {
    const fixture = await createPlannedFixture();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-"));
    const first = Buffer.from("first-version-bytes");
    const second = Buffer.from("second-version-bytes");

    const firstRun = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning({ remoteUrl: null, binary: first, format: "png" }),
      storageDir
    });
    if (firstRun.kind !== "saved") throw new Error(`expected saved, got ${firstRun.kind}`);
    const firstPath = firstRun.assets.find((a) => a.id === fixture.assetId)?.filePath;
    if (!firstPath) throw new Error("first generation should store a file");

    // 第二次生成要基于第一次推进后的 updatedAt，否则会撞乐观锁。
    const secondRun = await generateImageAsset(
      { ...fixture, expectedUpdatedAt: firstRun.article.updatedAt },
      {
        images: fixture.imagesRepo,
        generator: generatorReturning({ remoteUrl: null, binary: second, format: "png" }),
        storageDir
      }
    );
    if (secondRun.kind !== "saved") throw new Error(`expected saved, got ${secondRun.kind}`);
    const secondPath = secondRun.assets.find((a) => a.id === fixture.assetId)?.filePath;

    // 两版落在两个不同文件上，且第一版的内容原封不动——这正是「不再覆盖」的核心保证。
    expect(secondPath).toBeTruthy();
    expect(secondPath).not.toBe(firstPath);
    expect((await readFile(firstPath)).equals(first)).toBe(true);
    expect((await readFile(secondPath!)).equals(second)).toBe(true);

    // 两版都记进素材库，最新一版是「使用中」。
    const generations = await fixture.imagesRepo.listGenerationsForAsset(
      fixture.articleId,
      fixture.assetId
    );
    expect(generations).toHaveLength(2);
    expect(generations.filter((g) => g.selected)).toHaveLength(1);
    expect(generations[0]?.filePath).toBe(secondPath);
  });

  it("removes the half-written file when the generation fails after writing", async () => {
    const fixture = await createPlannedFixture();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-"));

    // 用 Proxy 只替换 completeGeneration：真仓储的其余方法（含原型上的）保持可用，
    // 直接展开实例会丢掉原型方法。
    const failingRepo = new Proxy(fixture.imagesRepo, {
      get(target, property, receiver) {
        if (property === "completeGeneration") {
          return async () => ({ kind: "conflict" as const });
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as ImageAssetRepository;

    const result = await generateImageAsset(fixture, {
      images: failingRepo,
      generator: generatorReturning({
        remoteUrl: null,
        binary: Buffer.from("orphan"),
        format: "png"
      }),
      storageDir
    });

    // 落盘成功但写库失败：文件不能留下，否则是没有任何记录指向的孤儿。
    expect(result).toMatchObject({ kind: "conflict" });
    expect(await readdir(storageDir)).toEqual([]);
  });

  it("marks the asset failed when the generator rejects", async () => {
    const fixture = await createPlannedFixture();

    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning(new Error("boom"))
    });

    expect(result).toMatchObject({ kind: "generator_error" });
    // 失败也落库过（帧置 failed、文章推进）：结果必须带回落库后的最新状态，
    // 前端回灌后重试的令牌才有效，否则陷入 409 死路只能整页刷新。
    if (result.kind !== "generator_error") throw new Error("expected generator_error");
    expect(result.article?.updatedAt).not.toBe(fixture.expectedUpdatedAt);
    expect(result.assets?.find((asset) => asset.id === fixture.assetId)?.status).toBe("failed");
    const asset = await fixture.imagesRepo.findById(fixture.articleId, fixture.assetId);
    expect(asset?.status).toBe("failed");
    expect(asset?.publicUrl).toBeNull();
    expect(asset?.filePath).toBeNull();
  });

  it("rejects a payload with neither url nor binary and marks the asset failed", async () => {
    const fixture = await createPlannedFixture();

    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning({ remoteUrl: null, binary: null, format: "png" })
    });

    expect(result).toMatchObject({ kind: "generator_error" });
    const asset = await fixture.imagesRepo.findById(fixture.articleId, fixture.assetId);
    expect(asset?.status).toBe("failed");
  });

  it("propagates not_found and conflict from beginGeneration", async () => {
    const db = createTestDatabase();
    const articlesRepo = new SqliteArticleRepository(db);
    const created = await articlesRepo.create({ topic: "机会成本" });
    const imagesRepo: ImageAssetRepository = new SqliteImageAssetRepository(db);

    const missing = await generateImageAsset(
      { articleId: created.id, assetId: "no-such-asset", expectedUpdatedAt: created.updatedAt },
      { images: imagesRepo, generator: generatorReturning({ remoteUrl: null, binary: null, format: "png" }) }
    );
    expect(missing).toEqual({ kind: "not_found" });

    const conflicted = await generateImageAsset(
      {
        articleId: created.id,
        assetId: "no-such-asset",
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z"
      },
      { images: imagesRepo, generator: generatorReturning({ remoteUrl: null, binary: null, format: "png" }) }
    );
    expect(conflicted).toEqual({ kind: "conflict" });
  });
});
