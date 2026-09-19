// @vitest-environment node

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteArticleRepository } from "@/features/articles/sqlite-repository";
import type {
  ReferenceCharacter,
  ReferenceCharacterRepository
} from "@/features/characters/domain";
import type { StyleLibraryEntry, StyleLibraryRepository, StyleProfile } from "@/features/style-library/domain";
import type { ImagePlanSettingsRepository } from "./plan-settings";
import type { ImagePlanSuggestion } from "./domain";
import { generateImageAsset } from "./generate-image-asset";
import type { GeneratedImagePayload, ImageGenerator, ImageGeneratorInput } from "./image-generator";
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

  it("keeps the plain prompt when no plan-settings dependency is provided", async () => {
    const fixture = await createPlannedFixture();
    const inputs: ImageGeneratorInput[] = [];
    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: {
        generate: async (input) => {
          inputs.push(input);
          return { remoteUrl: null, binary: Buffer.from("img"), format: "png" };
        }
      }
    });
    expect(result.kind).toBe("saved");
    expect(inputs[0]?.prompt).toBe("机会成本的清晰中文信息图");
    expect(inputs[0]?.referenceImages).toBeUndefined();
  });
});

describe("generateImageAsset with plan-settings enhancements", () => {
  function settingsReturning(settings: { style: string; characterId: string | null }): ImagePlanSettingsRepository {
    return { get: async () => settings, set: async () => undefined };
  }

  function characterFixture(overrides: Partial<ReferenceCharacter> = {}): ReferenceCharacter {
    return {
      id: "char-1",
      name: "蘑菇老师",
      persona: "科普老师",
      description: "戴圆框眼镜的蘑菇头卡通形象",
      mimeType: "image/png",
      filePath: "",
      publicUrl: "/api/characters/char-1/image",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      ...overrides
    };
  }

  function charactersReturning(records: ReferenceCharacter[]): ReferenceCharacterRepository {
    return {
      list: async () => records,
      findById: async (id: string) => records.find((record) => record.id === id) ?? null,
      create: async () => {
        throw new Error("not used in this test");
      },
      update: async () => null,
      remove: async () => false
    };
  }

  const PROFILE: StyleProfile = {
    name: "暖调扁平",
    summary: "暖色扁平插画风格，适合科普配图",
    palette: ["#F5E6D3", "#E8927C", "#3E6B48"],
    lineWork: "圆润均匀的描边，无渐变",
    characterDesign: "圆润简洁的卡通角色，比例 2 头身",
    composition: "中心构图，主体突出",
    background: "单色或简单几何背景",
    textRendering: "无文字或少量清晰中文标注",
    promptTemplate: "扁平插画：暖纸底色，柔和阴影，色块干净，边线圆润，整体像绘本内页"
  };

  function styleLibraryReturning(entries: StyleLibraryEntry[]): StyleLibraryRepository {
    return {
      list: async () => entries,
      findById: async (id: string) => entries.find((entry) => entry.id === id) ?? null,
      upsert: async () => {
        throw new Error("not used in this test");
      }
    };
  }

  function capturingGenerator(inputs: ImageGeneratorInput[]): ImageGenerator {
    return {
      generate: async (input) => {
        inputs.push(input);
        return { remoteUrl: null, binary: Buffer.from("img"), format: "png" };
      }
    };
  }

  it("injects style text, character text and the reference image into the generator input", async () => {
    const fixture = await createPlannedFixture();
    const storageDir = await mkdtemp(join(tmpdir(), "wo-xi-gen-"));
    const referencePng = Buffer.from("reference-character-png");
    const referencePath = join(storageDir, "character.png");
    await writeFile(referencePath, referencePng);

    const inputs: ImageGeneratorInput[] = [];
    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: capturingGenerator(inputs),
      storageDir,
      planSettings: settingsReturning({ style: "扁平插画，暖色调", characterId: "char-1" }),
      characters: charactersReturning([characterFixture({ filePath: referencePath })])
    });

    expect(result.kind).toBe("saved");
    expect(inputs).toHaveLength(1);
    const input = inputs[0]!;
    expect(input.prompt).toContain("【绘制风格】");
    expect(input.prompt).toContain("扁平插画，暖色调");
    expect(input.prompt).toContain("【参考形象】蘑菇老师（科普老师）");
    expect(input.prompt).toContain("外形描述：戴圆框眼镜的蘑菇头卡通形象");
    // 原 prompt 仍在增强文本之后，作为画面主描述。
    expect(input.prompt.indexOf("【绘制风格】")).toBeLessThan(input.prompt.indexOf("机会成本的清晰中文信息图"));
    expect(input.referenceImages).toHaveLength(1);
    expect(input.referenceImages?.[0]?.data.equals(referencePng)).toBe(true);
    expect(input.referenceImages?.[0]?.mimeType).toBe("image/png");
  });

  it("resolves a library style reference to the full style guide text", async () => {
    const fixture = await createPlannedFixture();
    const entry: StyleLibraryEntry = {
      id: "style-9",
      name: "暖调扁平",
      profile: PROFILE,
      source: "test",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    };
    const inputs: ImageGeneratorInput[] = [];
    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: capturingGenerator(inputs),
      planSettings: settingsReturning({ style: "library:style-9", characterId: null }),
      characters: charactersReturning([]),
      styleLibrary: styleLibraryReturning([entry])
    });

    expect(result.kind).toBe("saved");
    expect(inputs[0]?.prompt).toContain("【画风】扁平插画：暖纸底色");
    expect(inputs[0]?.prompt).toContain("【主色板】");
    expect(inputs[0]?.referenceImages).toBeUndefined();
  });

  it("skips only the reference image when the character file is unreadable", async () => {
    const fixture = await createPlannedFixture();
    const inputs: ImageGeneratorInput[] = [];
    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: capturingGenerator(inputs),
      planSettings: settingsReturning({ style: "", characterId: "char-1" }),
      characters: charactersReturning([characterFixture({ filePath: join(tmpdir(), "no-such-file.png") })])
    });

    expect(result.kind).toBe("saved");
    expect(inputs[0]?.prompt).toContain("【参考形象】蘑菇老师（科普老师）");
    expect(inputs[0]?.prompt).not.toContain("【绘制风格】");
    expect(inputs[0]?.referenceImages).toBeUndefined();
  });

  it("degrades to the plain prompt when the configured library style no longer exists", async () => {
    const fixture = await createPlannedFixture();
    const inputs: ImageGeneratorInput[] = [];
    const result = await generateImageAsset(fixture, {
      images: fixture.imagesRepo,
      generator: capturingGenerator(inputs),
      planSettings: settingsReturning({ style: "library:gone", characterId: null }),
      styleLibrary: styleLibraryReturning([])
    });

    expect(result.kind).toBe("saved");
    expect(inputs[0]?.prompt).toBe("机会成本的清晰中文信息图");
    expect(inputs[0]?.referenceImages).toBeUndefined();
  });
});
