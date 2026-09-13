// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
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
    expect(asset?.filePath).toContain(`${fixture.assetId}.png`);
  });

  it("marks the asset failed when the generator rejects", async () => {
    const fixture = await createPlannedFixture();

    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: generatorReturning(new Error("boom"))
    });

    expect(result).toMatchObject({ kind: "generator_error" });
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
