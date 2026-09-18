// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ImageGeneratorError } from "@/features/images/image-generator";
import {
  buildCharacterDescription,
  buildCharacterReferencePrompt,
  generateReferenceCharacter,
  type GenerateReferenceCharacterDeps
} from "./generate-reference-character";
import type { ReferenceCharacter } from "./domain";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type GenerateInput = { prompt: string; aspectRatio: string; model?: string };
type GeneratePayload = { remoteUrl: string | null; binary: Buffer | null; format: string };

function fakeGenerator(returnOverrides: Partial<GeneratePayload> = {}) {
  return {
    generate: vi.fn<(input: GenerateInput) => Promise<GeneratePayload>>(async () => ({
      remoteUrl: null,
      binary: PNG_BYTES,
      format: "png",
      ...returnOverrides
    }))
  };
}

function fakeRepo() {
  const created = vi.fn(async (record, id?: string) => ({
    id: id ?? "auto-id",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    publicUrl: `/api/characters/${id ?? "auto-id"}/image`,
    ...record
  }) as ReferenceCharacter);
  return { create: created };
}

function fakeStore() {
  return { save: vi.fn(() => "/tmp/char.png"), read: vi.fn(), remove: vi.fn() };
}

describe("buildCharacterReferencePrompt", () => {
  it("weaves persona, appearance and style into the reference-sheet prompt", () => {
    const prompt = buildCharacterReferencePrompt({
      persona: "自媒体科普老师",
      appearance: "圆框眼镜的蘑菇头角色",
      styleText: "简笔画，线条涂鸦"
    });
    expect(prompt).toContain("角色参考设定图");
    expect(prompt).toContain("全身");
    expect(prompt).toContain("纯白背景（#FFFFFF）");
    expect(prompt).toContain("自媒体科普老师");
    expect(prompt).toContain("圆框眼镜的蘑菇头角色");
    expect(prompt).toContain("简笔画，线条涂鸦");
  });

  it("falls back to original-design and default style wording when inputs are empty", () => {
    const prompt = buildCharacterReferencePrompt({ persona: "", appearance: "", styleText: "" });
    expect(prompt).toContain("外观由你原创设计");
    expect(prompt).toContain("日系动漫画风");
  });
});

describe("buildCharacterDescription", () => {
  it("joins appearance, persona and style summary within the column limit", () => {
    const description = buildCharacterDescription({
      persona: "自媒体科普老师",
      appearance: "圆框眼镜的蘑菇头角色",
      styleSummary: "简笔画"
    });
    expect(description).toContain("圆框眼镜的蘑菇头角色");
    expect(description).toContain("身份：自媒体科普老师");
    expect(description).toContain("画风：简笔画");
    expect(description.length).toBeLessThanOrEqual(1000);
  });

  it("uses original-design wording when appearance is empty", () => {
    const description = buildCharacterDescription({ persona: "", appearance: "", styleSummary: "" });
    expect(description).toContain("AI 原创设计");
  });
});

describe("generateReferenceCharacter", () => {
  const input = {
    name: "蘑菇老师",
    persona: "自媒体科普老师",
    appearance: "圆框眼镜的蘑菇头角色",
    styleText: "简笔画，线条涂鸦"
  };

  it("generates a portrait image, stores it and keeps the extracted description", async () => {
    const generator = fakeGenerator();
    const describer = { describe: vi.fn(async () => "红伞白点的卡通蘑菇，戴圆框眼镜") };
    const deps: GenerateReferenceCharacterDeps = {
      generator: generator as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer
    };

    const character = await generateReferenceCharacter(input, deps);

    // 生图请求：竖版全身设定图。
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "portrait", prompt: expect.stringContaining("角色参考设定图") })
    );
    // 落盘用上游声明的格式映射 mime；描述取看图提取文本。
    expect(deps.store.save).toHaveBeenCalledWith(expect.any(String), "image/png", PNG_BYTES);
    expect(character.description).toBe("红伞白点的卡通蘑菇，戴圆框眼镜");
    expect(character.name).toBe("蘑菇老师");
    expect(character.persona).toBe("自媒体科普老师");
  });

  it("passes the requested image model through to the generator", async () => {
    const generator = fakeGenerator();
    const deps: GenerateReferenceCharacterDeps = {
      generator: generator as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer: null
    };

    await generateReferenceCharacter({ ...input, model: "gpt-image-2" }, deps);
    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-image-2" }));
  });

  it("falls back to the constructed description when no describer is available", async () => {
    const deps: GenerateReferenceCharacterDeps = {
      generator: fakeGenerator() as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer: null
    };

    const character = await generateReferenceCharacter(input, deps);
    expect(character.description).toContain("圆框眼镜的蘑菇头角色");
    expect(character.description).toContain("画风：简笔画，线条涂鸦");
  });

  it("keeps the generated image even when the describer fails", async () => {
    const describer = { describe: vi.fn(async () => { throw new Error("vision down"); }) };
    const deps: GenerateReferenceCharacterDeps = {
      generator: fakeGenerator() as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer
    };

    const character = await generateReferenceCharacter(input, deps);
    expect(character.description).toContain("圆框眼镜的蘑菇头角色");
  });

  it("rejects responses without image bytes", async () => {
    const generator = fakeGenerator({ binary: null });
    const deps: GenerateReferenceCharacterDeps = {
      generator: generator as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer: null
    };

    await expect(generateReferenceCharacter(input, deps)).rejects.toMatchObject({
      name: "ImageGeneratorError",
      code: "invalid_response"
    });
  });

  it("wraps unexpected generator failures as upstream errors", async () => {
    const generator = { generate: vi.fn(async () => { throw new Error("boom"); }) };
    const deps: GenerateReferenceCharacterDeps = {
      generator: generator as unknown as GenerateReferenceCharacterDeps["generator"],
      characters: fakeRepo() as unknown as GenerateReferenceCharacterDeps["characters"],
      store: fakeStore() as unknown as GenerateReferenceCharacterDeps["store"],
      describer: null
    };

    await expect(generateReferenceCharacter(input, deps)).rejects.toBeInstanceOf(ImageGeneratorError);
  });
});
