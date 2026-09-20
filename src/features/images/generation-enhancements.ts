import { readFile } from "node:fs/promises";
import type { ReferenceCharacter, ReferenceCharacterRepository } from "@/features/characters/domain";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import {
  isLibraryStyleRef,
  libraryStyleId,
  styleToGuideText
} from "@/features/style-library/style-guide";
import type { ImageAspectRatio } from "./domain";
import { isContentBlockedError } from "./image-generator";
import type { GeneratedImagePayload, ImageGenerator, ReferenceImage } from "./image-generator";
import type { ImagePlanSettingsRepository } from "./plan-settings";

/**
 * 第四步帧生成的可选增强依赖：配图偏好（画风 + 参考形象）与解析它们的仓储。
 * 全部可缺省——缺省或读取失败时生成退化为纯 prompt，绝不阻断主链路。
 */
export interface GenerationEnhancementDependencies {
  planSettings?: ImagePlanSettingsRepository | null;
  characters?: ReferenceCharacterRepository | null;
  styleLibrary?: StyleLibraryRepository | null;
}

export interface GenerationEnhancements {
  /** 前置到资产 prompt 之前的画风/形象文本块；无注入内容时为空串。 */
  promptPrefix: string;
  /** 参考形象图（图生图 i2i）；无参考形象或文件不可读时为空数组。 */
  referenceImages: ReferenceImage[];
}

const EMPTY_ENHANCEMENTS: GenerationEnhancements = { promptPrefix: "", referenceImages: [] };

/** 参考形象文本块：名字 + 身份 + 外形描述，附「与参考图保持一致」的约束。 */
function characterPromptText(record: ReferenceCharacter): string {
  const persona = record.persona.trim();
  const lines = [`【参考形象】${persona ? `${record.name}（${persona}）` : record.name}`];
  const description = record.description.trim();
  if (description) lines.push(`外形描述：${description}`);
  lines.push(
    "（该角色出现在画面时，外形必须与上述描述及附带的参考形象图保持一致；场景与其他内容仍以提示词为准）"
  );
  return lines.join("\n");
}

/** 读取参考形象图二进制；文件缺失或为空时返回 null（只保留文本注入，不阻断生成）。 */
async function loadReferenceImage(record: ReferenceCharacter): Promise<ReferenceImage | null> {
  if (!record.filePath) return null;
  try {
    const data = await readFile(record.filePath);
    if (data.length === 0) return null;
    return { data, mimeType: record.mimeType || "image/png" };
  } catch {
    return null;
  }
}

/**
 * 读取文章的配图偏好，组装帧生成增强：画风文本（风格库条目解析成完整风格文本）
 * 与参考形象（文本块 + 参考图二进制）。任何读取失败都退化为空增强——
 * 偏好只是提升一致性的手段，不能让生成挂掉。
 */
export async function buildGenerationEnhancements(
  articleId: string,
  dependencies: GenerationEnhancementDependencies
): Promise<GenerationEnhancements> {
  const { planSettings, characters, styleLibrary } = dependencies;
  if (!planSettings) return { ...EMPTY_ENHANCEMENTS };
  try {
    const settings = await planSettings.get(articleId);
    const blocks: string[] = [];
    const referenceImages: ReferenceImage[] = [];

    // 画风：风格库条目（library:<id>）由服务端解析成完整风格文本，自由文本原样使用；
    // 指向已删除的条目时静默跳过。
    const style = settings.style.trim();
    if (style) {
      let styleText: string | null = null;
      if (isLibraryStyleRef(style)) {
        const entry = styleLibrary ? await styleLibrary.findById(libraryStyleId(style)) : null;
        if (entry) styleText = styleToGuideText(entry.profile);
      } else {
        styleText = style;
      }
      if (styleText) {
        blocks.push(`【绘制风格】以下画风约束必须严格套用到整幅画面：\n${styleText}`);
      }
    }

    // 参考形象：文本块必进 prompt，参考图二进制尽力读取。
    if (settings.characterId && characters) {
      const record = await characters.findById(settings.characterId);
      if (record) {
        blocks.push(characterPromptText(record));
        const image = await loadReferenceImage(record);
        if (image) referenceImages.push(image);
      }
    }

    return { promptPrefix: blocks.join("\n\n"), referenceImages };
  } catch {
    // 偏好读取失败（表损坏等）不阻断生成：退化为纯 prompt。
    return { ...EMPTY_ENHANCEMENTS };
  }
}

/** 把增强文本前置到资产 prompt 上；无增强时原样返回。 */
export function composeEnhancedPrompt(assetPrompt: string, enhancements: GenerationEnhancements) {
  return enhancements.promptPrefix
    ? `${enhancements.promptPrefix}\n\n${assetPrompt}`
    : assetPrompt;
}

/** 有参考图才携带 referenceImages 字段，保持无增强时的生成输入与旧行为完全一致。 */
export function referenceImagesField(enhancements: GenerationEnhancements) {
  return enhancements.referenceImages.length ? { referenceImages: enhancements.referenceImages } : {};
}

/**
 * 带降级的生成：先用「画风引导 + 原始提示词」调上游；若被内容策略拦截，
 * 去掉附加的画风文本、只发设计稿的原始提示词再试一次。
 *
 * 为什么要有这个降级：画风引导是逐帧前置的长文本（实测 1193 字），
 * 上游 M365 内容策略会间歇性地把含它的请求整批拦掉（同一段文本换个时刻又能过）。
 * 增强只是提升一致性的手段，不该成为「一炸全炸」的单点——实测拦截率 0/3 → 3/3 的
 * A/B 差异就出现在加不加这段文本上，所以这里把它当作第一顺位可疑因素剥掉。
 * 参考图保留：它是画面相似度的实质收益，且拦截证据都指向文本而非图片。
 */
export async function generateWithEnhancementFallback(
  generator: ImageGenerator,
  asset: { prompt: string; aspectRatio: ImageAspectRatio },
  enhancements: GenerationEnhancements,
  model?: string
): Promise<GeneratedImagePayload> {
  const shared = {
    aspectRatio: asset.aspectRatio,
    ...referenceImagesField(enhancements),
    ...(model ? { model } : {})
  };
  try {
    return await generator.generate({
      prompt: composeEnhancedPrompt(asset.prompt, enhancements),
      ...shared
    });
  } catch (error) {
    if (!enhancements.promptPrefix || !isContentBlockedError(error)) throw error;
    return await generator.generate({ prompt: asset.prompt, ...shared });
  }
}
