import { randomUUID } from "node:crypto";
import type { CharacterImageStore } from "@/server/character-storage";
import type { ImageGenerator } from "@/features/images/image-generator";
import { ImageGeneratorError } from "@/features/images/image-generator";
import type {
  NewReferenceCharacter,
  ReferenceCharacter,
  ReferenceCharacterRepository
} from "./domain";
import type { CharacterDescriber } from "./character-describer";

/**
 * 「AI 生成参考形象」的输入。外观与身份都可留空：留空时由模型在给定风格下
 * 原创设计一个便于重复绘制的漫画主角。
 */
export interface GenerateReferenceCharacterInput {
  name: string;
  persona: string;
  appearance: string;
  /** 已由调用方解析好的完整风格文本；空串表示不指定风格。 */
  styleText: string;
  /** 生成用的生图模型 id；缺省用服务端默认模型。 */
  model?: string;
}

export interface GenerateReferenceCharacterDeps {
  generator: ImageGenerator;
  characters: ReferenceCharacterRepository;
  store: CharacterImageStore;
  /** 看图提取：生成成功后从图里提取真实长相作为 description；不可用时回落构造文本。 */
  describer: CharacterDescriber | null;
}

/**
 * 角色参考设定图的生图提示词。参考形象的用途是「在后续每格配图提示词里复现同一个角色」，
 * 所以画面要求围绕可复现性：单人全身、纯白底、细节与颜色明确。
 */
export function buildCharacterReferencePrompt(input: {
  persona: string;
  appearance: string;
  styleText: string;
}): string {
  return [
    "为公众号知识类漫画绘制一张「角色参考设定图」：单个角色的全身立绘。",
    "- 全身完整可见（头到脚，不裁切），正面站姿，表情自然亲和；",
    "- 画面只有这一个角色：纯白背景（#FFFFFF），无场景、无道具、无文字；",
    input.persona
      ? `- 角色身份：${input.persona}，造型与气质要符合该身份；`
      : "- 角色是通用的漫画主角，造型简洁、辨识度高；",
    input.appearance
      ? `- 外观设定：${input.appearance}；`
      : "- 外观由你原创设计：轮廓与配色清晰，便于在多幅画面中重复绘制；",
    `- 绘制风格：${input.styleText || "日系动漫画风，清晰线条、赛璐璐上色、明快配色"}；`,
    "- 五官、发型、服装细节清楚，颜色明确，同一角色后续要在多张图里保持一致。"
  ].join("\n");
}

/**
 * description 的兜底文本：用于在绘图提示词中复现该形象。
 * 只在无法跑看图提取（无 LLM 配置或提取失败）时使用。
 */
export function buildCharacterDescription(input: {
  persona: string;
  appearance: string;
  styleSummary: string;
}): string {
  const parts = [
    input.appearance || "外观由 AI 原创设计的漫画形象：造型简洁、辨识度高",
    input.persona ? `身份：${input.persona}` : "",
    input.styleSummary ? `画风：${input.styleSummary}` : ""
  ].filter(Boolean);
  return parts.join("；").slice(0, 1000);
}

/**
 * 用生图服务画一张角色参考设定图，并作为参考形象入库。
 * 描述优先取看图提取的真实长相（与上传路径同构）；提取不可用时回落构造文本。
 */
export async function generateReferenceCharacter(
  input: GenerateReferenceCharacterInput,
  deps: GenerateReferenceCharacterDeps
): Promise<ReferenceCharacter> {
  const prompt = buildCharacterReferencePrompt(input);
  let payload;
  try {
    payload = await deps.generator.generate({
      prompt,
      aspectRatio: "portrait",
      ...(input.model ? { model: input.model } : {})
    });
  } catch (error) {
    if (error instanceof ImageGeneratorError) throw error;
    throw new ImageGeneratorError("upstream", "参考形象生成失败，请稍后重试");
  }
  // 网关强制 b64_json，正常都有二进制；只回链接时无法落参考图库，明确报错而不是存一个空形象。
  if (!payload.binary) {
    throw new ImageGeneratorError("invalid_response", "生成结果缺少图像数据，请稍后重试");
  }

  const mimeType = CHARACTER_MIME_BY_FORMAT[payload.format.toLowerCase()] ?? "image/png";
  const id = randomUUID();
  const filePath = deps.store.save(id, mimeType, payload.binary);

  // 看图提取失败不整体失败——图已生成落盘，回落到构造文本即可。
  let description = buildCharacterDescription({
    persona: input.persona,
    appearance: input.appearance,
    styleSummary: input.styleText.slice(0, 120)
  });
  if (deps.describer) {
    try {
      const imageDataUrl = `data:${mimeType};base64,${payload.binary.toString("base64")}`;
      description = await deps.describer.describe({ imageDataUrl, ...(input.model ? { model: input.model } : {}) });
    } catch {
      // 回落文本已在上方构造好。
    }
  }

  const record: NewReferenceCharacter = {
    name: input.name,
    persona: input.persona,
    description,
    mimeType,
    filePath
  };
  return deps.characters.create(record, id);
}

const CHARACTER_MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp"
};
