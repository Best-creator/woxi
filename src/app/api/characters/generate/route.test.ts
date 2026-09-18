// @vitest-environment node

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/test-db";
import { createCharacterImageStore } from "@/server/character-storage";
import { SqliteReferenceCharacterRepository } from "@/features/characters/sqlite-repository";
import type { ImageGenerator } from "@/features/images/image-generator";
import { ImageGeneratorError } from "@/features/images/image-generator";
import type { CharacterDescriber } from "@/features/characters/character-describer";
import type { StyleLibraryRepository } from "@/features/style-library/domain";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeStyleProfile() {
  return {
    name: "复古漫画",
    summary: "六十年代复古印刷漫画风",
    palette: ["#E85D3D", "#F2C14E", "#2E4057"],
    lineWork: "粗细变化的描边线条，带轻微印刷噪点",
    characterDesign: "圆润头身比的小动物角色，腮红明显",
    composition: "居中主体，留白呼吸感",
    background: "纯白背景",
    textRendering: "手写体标注文字",
    promptTemplate: "六十年代复古印刷漫画，网点纸质感，暖色为主，角色造型圆润可爱"
  };
}

function fakeGenerator() {
  return {
    generate: vi.fn<
      (input: { prompt: string; aspectRatio: string; model?: string }) => Promise<{
        remoteUrl: string | null;
        binary: Buffer;
        format: string;
      }>
    >(async () => ({ remoteUrl: null, binary: PNG_BYTES, format: "png" }))
  };
}

function fakeDescriber() {
  return { describe: vi.fn(async () => "红伞白点的卡通蘑菇，戴圆框眼镜") };
}

function fakeStyleLibrary() {
  return {
    list: vi.fn(async () => []),
    findById: vi.fn(async (id: string) =>
      id === "style-1"
        ? {
            id: "style-1",
            name: "复古漫画",
            profile: fakeStyleProfile(),
            source: "test",
            createdAt: "2026-09-18T00:00:00.000Z",
            updatedAt: "2026-09-18T00:00:00.000Z"
          }
        : null
    ),
    upsert: vi.fn()
  };
}

interface DepsOverrides {
  generator?: ImageGenerator | null;
  describer?: CharacterDescriber | null;
  styleLibrary?: StyleLibraryRepository | null;
}

function setup(overrides: DepsOverrides = {}) {
  const characters = new SqliteReferenceCharacterRepository(createTestDatabase());
  const store = createCharacterImageStore(mkdtempSync(join(tmpdir(), "woxi-char-gen-")));
  const generator =
    overrides.generator !== undefined ? overrides.generator : (fakeGenerator() as unknown as ImageGenerator);
  const describer =
    overrides.describer !== undefined ? overrides.describer : (fakeDescriber() as unknown as CharacterDescriber);
  const styleLibrary =
    overrides.styleLibrary !== undefined
      ? overrides.styleLibrary
      : (fakeStyleLibrary() as unknown as StyleLibraryRepository);
  return {
    characters,
    store,
    generator,
    describer,
    styleLibrary,
    generatorMock: generator as ReturnType<typeof fakeGenerator> | null,
    describerMock: describer as ReturnType<typeof fakeDescriber> | null,
    styleLibraryMock: styleLibrary as ReturnType<typeof fakeStyleLibrary>
  };
}

function generateBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "蘑菇老师",
    persona: "自媒体科普老师",
    appearance: "圆框眼镜的蘑菇头角色",
    style: "简笔画",
    ...overrides
  };
}

async function post(handlerDeps: ReturnType<typeof setup>, body: Record<string, unknown>) {
  const { createCharacterGenerateRouteHandler } = await import("./route");
  const handler = createCharacterGenerateRouteHandler({
    characters: handlerDeps.characters,
    store: handlerDeps.store,
    generator: handlerDeps.generator,
    describer: handlerDeps.describer,
    styleLibrary: handlerDeps.styleLibrary
  });
  return handler(
    new Request("http://test/characters/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/characters/generate", () => {
  it("generates a reference character image and stores it in the library", async () => {
    const deps = setup();
    const response = await post(deps, generateBody());
    expect(response.status).toBe(201);
    const { character } = (await response.json()) as {
      character: { id: string; description: string; publicUrl: string; filePath: string };
    };

    expect(character.publicUrl).toBe(`/api/characters/${character.id}/image`);
    // 描述 = 看图提取的真实长相 + 画风要点（复现用）。
    expect(character.description).toContain("红伞白点的卡通蘑菇");
    expect(character.description).toContain("画风：简笔画");
    // 图确实落盘。
    expect(existsSync(character.filePath)).toBe(true);
    // 生图请求是竖版全身设定图。
    expect(deps.generatorMock?.generate).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "portrait", prompt: expect.stringContaining("角色参考设定图") })
    );
  });

  it("expands library style refs into the full guide text", async () => {
    const deps = setup();
    const response = await post(deps, generateBody({ style: "library:style-1" }));
    expect(response.status).toBe(201);
    const prompt = deps.generatorMock?.generate.mock.calls[0]?.[0] as { prompt: string };
    expect(prompt.prompt).toContain("【画风】");
    expect(prompt.prompt).toContain("六十年代复古印刷漫画");
  });

  it("rejects missing library style refs with 400", async () => {
    const deps = setup();
    const response = await post(deps, generateBody({ style: "library:missing" }));
    expect(response.status).toBe(400);
  });

  it("passes the requested image model through", async () => {
    const deps = setup();
    await post(deps, generateBody({ model: "gpt-image-2" }));
    expect(deps.generatorMock?.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-image-2" })
    );
  });

  it("returns 503 when the image generation service is not configured", async () => {
    const deps = setup({ generator: null });
    const response = await post(deps, generateBody());
    expect(response.status).toBe(503);
  });

  it("returns 400 for a missing or overlong name", async () => {
    const deps = setup();
    expect((await post(deps, generateBody({ name: "" }))).status).toBe(400);
    expect((await post(deps, generateBody({ name: "x".repeat(41) }))).status).toBe(400);
  });

  it("maps generator failures to 502 with the upstream message", async () => {
    const failing = {
      generate: vi.fn(async () => {
        throw new ImageGeneratorError("timeout", "图片生成响应超时，请稍后重试。");
      })
    };
    const deps = setup({ generator: failing as unknown as ImageGenerator });
    const response = await post(deps, generateBody());
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("超时");
  });
});
