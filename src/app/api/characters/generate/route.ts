import { z } from "zod";
import type { ReferenceCharacterRepository } from "@/features/characters/domain";
import {
  generateReferenceCharacter
} from "@/features/characters/generate-reference-character";
import type { ImageGenerator } from "@/features/images/image-generator";
import type { CharacterDescriber } from "@/features/characters/character-describer";
import type { CharacterImageStore } from "@/server/character-storage";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import {
  isLibraryStyleRef,
  libraryStyleId,
  styleToGuideText
} from "@/features/style-library/style-guide";
import {
  getCharacterImageStore,
  getCharacterDescriber,
  getImageGenerator,
  getReferenceCharacterRepository,
  getStyleLibraryRepository
} from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  name: z.string().trim().min(1, "请填写形象名称").max(40),
  persona: z.string().trim().max(200).default(""),
  appearance: z.string().trim().max(500).default(""),
  /** 与配图规划同一套取值：预设词 / library:<id> / 自定义文本；空串 = 不指定风格。 */
  style: z.string().trim().max(200).default(""),
  model: z.string().trim().min(1).optional()
});

interface RouteDeps {
  characters: ReferenceCharacterRepository;
  store: CharacterImageStore;
  generator: ImageGenerator | null;
  describer: CharacterDescriber | null;
  styleLibrary: StyleLibraryRepository | null;
}

export function createCharacterGenerateRouteHandler({
  characters,
  store,
  generator,
  describer,
  styleLibrary
}: RouteDeps) {
  return async function POST(request: Request) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    const input = requestSchema.safeParse(body);
    if (!input.success) {
      return Response.json({ error: "请检查形象名称（必填、不超过 40 字）与其他输入长度" }, { status: 400 });
    }
    if (!generator) {
      return Response.json(
        { error: "生图服务未配置，无法生成参考形象；可在设置页配置生图 provider，或改用上传参考图" },
        { status: 503 }
      );
    }

    // 风格解析与配图规划同构：风格库条目由服务端展开成完整风格文本，不信任客户端拼好的长文案。
    let styleText = "";
    let styleSummary = "";
    if (input.data.style) {
      if (isLibraryStyleRef(input.data.style)) {
        if (!styleLibrary) {
          return Response.json({ error: "风格库功能不可用" }, { status: 400 });
        }
        const entry = await styleLibrary.findById(libraryStyleId(input.data.style));
        if (!entry) {
          return Response.json({ error: "所选风格已不存在，请重新选择" }, { status: 400 });
        }
        styleText = styleToGuideText(entry.profile);
        styleSummary = entry.profile.summary;
      } else {
        styleText = input.data.style;
        styleSummary = input.data.style.slice(0, 120);
      }
    }

    try {
      const character = await generateReferenceCharacter(
        {
          name: input.data.name,
          persona: input.data.persona,
          appearance: input.data.appearance,
          styleText,
          ...(input.data.model ? { model: input.data.model } : {})
        },
        // 提取描述时补充画风要点，让兜底/提取文本都能复现画风。
        {
          generator,
          characters,
          store,
          describer: describer
            ? {
                describe: async (describeInput) => {
                  const extracted = await describer.describe(describeInput);
                  return styleSummary ? `${extracted}；画风：${styleSummary}` : extracted;
                }
              }
            : null
        }
      );
      return Response.json({ character }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "参考形象生成失败，请稍后重试";
      return Response.json({ error: message }, { status: 502 });
    }
  };
}

export function POST(request: Request) {
  return createCharacterGenerateRouteHandler({
    characters: getReferenceCharacterRepository(),
    store: getCharacterImageStore(),
    generator: getImageGenerator(),
    describer: getCharacterDescriber(),
    styleLibrary: getStyleLibraryRepository()
  })(request);
}
