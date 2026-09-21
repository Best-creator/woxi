import { readFile } from "node:fs/promises";
import type { ReferenceCharacter, ReferenceCharacterRepository } from "@/features/characters/domain";
import type { StyleLibraryRepository } from "@/features/style-library/domain";
import type { ImageAspectRatio, ImageAssetType } from "./domain";
import { isContentBlockedError } from "./image-generator";
import type { GeneratedImagePayload, ImageGenerator, ReferenceImage } from "./image-generator";
import type { ImagePlanSettingsRepository } from "./plan-settings";
import { sanitizeImagePrompt } from "./sanitize-image-prompt";
import { resolveStyleText } from "./style-text";

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
  /**
   * 解析出来的画风文本（风格库画像，或作者手写的一句话画风）；没有画风时为空串。
   * 单独留一份是因为「有没有画风」决定要不要加末尾的「画风优先」指令——
   * 只有参考形象、没有画风时，那句约束是多余的噪音。
   */
  styleText: string;
  /** 前置到资产 prompt 之前的画风/形象文本块；无注入内容时为空串。 */
  promptPrefix: string;
  /** 参考形象图（图生图 i2i）；无参考形象或文件不可读时为空数组。 */
  referenceImages: ReferenceImage[];
}

const EMPTY_ENHANCEMENTS: GenerationEnhancements = { styleText: "", promptPrefix: "", referenceImages: [] };

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
  dependencies: GenerationEnhancementDependencies,
  options: { frame?: boolean } = {}
): Promise<GenerationEnhancements> {
  const { planSettings, characters, styleLibrary } = dependencies;
  if (!planSettings) return { ...EMPTY_ENHANCEMENTS };
  try {
    const settings = await planSettings.get(articleId);
    const blocks: string[] = [];
    const referenceImages: ReferenceImage[] = [];

    // 画风：风格库条目（library:<id>）由服务端解析成完整风格文本，自由文本原样使用；
    // 指向已删除的条目时静默跳过。分镜帧用单格裁剪版（整页排版对单格是错误指令）。
    const styleText = (await resolveStyleText(settings.style, styleLibrary, { frame: options.frame })) ?? "";
    if (styleText) {
      blocks.push(`【绘制风格】以下画风约束必须严格套用到整幅画面：\n${styleText}`);
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

    return { styleText, promptPrefix: blocks.join("\n\n"), referenceImages };
  } catch {
    // 偏好读取失败（表损坏等）不阻断生成：退化为纯 prompt。
    return { ...EMPTY_ENHANCEMENTS };
  }
}

/**
 * 把增强文本前置到资产 prompt 上；无增强时原样返回。
 *
 * 末尾那句「画风优先」是在补一个真实踩过的坑：分镜设计阶段写下的帧提示词里自带
 * 「日系动漫画风、赛璐璐上色」这类风格词（设计时没拿到画风，走了默认口径），
 * 与前面注入的画风引导直接冲突——实测出图完全按帧提示词走，所选的混知风一点没落地。
 * 画风只在生成阶段注入，所以这份文本里出现的风格/技法词必须让位；
 * 而角色、动作、场景、道具仍然以画面描述为准（那才是设计稿的价值）。
 *
 * `suppressText` 是画风画像的另一个冲突面：画像里「居中章节标题、橙色对话框、圆形旁白头像」
 * 描述的是**整页条漫**的排版，我们出的是**单格**帧、文字由渲染器另行烘字——不压住它，
 * 模型会往帧里自己画标题和气泡（实测出图里就冒出了手写对白气泡和「柳州螺蛳粉」标牌），
 * 与渲染器烘的台词条重复。所以单格帧额外要求「画面里不出现任何文字」。
 */
export function composeEnhancedPrompt(
  assetPrompt: string,
  enhancements: GenerationEnhancements,
  options: { suppressText?: boolean } = {}
) {
  if (!enhancements.promptPrefix) return assetPrompt;
  const blocks = [enhancements.promptPrefix, assetPrompt];
  if (enhancements.styleText) {
    blocks.push(
      "【画风优先】上面【绘制风格】是全图唯一的画风来源：本段描述里的角色、动作、场景、道具照画，" +
        "但其中的画风、媒介与技法词（如日系动漫、赛璐璐、厚涂、写实）一律忽略，不得套用。"
    );
  }
  if (options.suppressText) {
    blocks.push(
      "【不画文字】这一格画面里不要出现任何文字：标题、对白气泡、旁白框、字幕一律不画；" +
        "场景道具上也不带字——招牌、柜台牌、店招、告示牌、价目表等一律画成无字的空白牌面" +
        "（台词与排版由我们另行完成）；上面关于标题/对话框/旁白头像/文字排版的描述只适用于整页长图。"
    );
  }
  return blocks.join("\n\n");
}

/** 有参考图才携带 referenceImages 字段，保持无增强时的生成输入与旧行为完全一致。 */
export function referenceImagesField(enhancements: GenerationEnhancements) {
  return enhancements.referenceImages.length ? { referenceImages: enhancements.referenceImages } : {};
}

/**
 * 带降级的生成：这是生图提示词离开本系统的**唯一出口**，两件事都在这里做——
 *
 * 1. **平台词净化**（`sanitizeImagePrompt`）：上游内容策略对「公众号/微信」这类平台名敏感，
 *    带它们的请求会被整批拦掉，换账号也过不去；这些词对画面零贡献，全部换成中性说法。
 * 2. **被内容策略拦就剥掉增强重试**：先用「画风引导 + 原始提示词」调上游；若被拦，去掉附加的
 *    画风文本、只发设计稿的原始提示词再试一次。
 *
 * 为什么第 2 条必要：画风引导是逐帧前置的长文本（实测 1168 字），上游 M365 内容策略会间歇性地
 * 把含它的请求整批拦掉（同一段文本换个时刻又能过）。增强只是提升一致性的手段，不该成为
 * 「一炸全炸」的单点。参考图保留：它是画面相似度的实质收益，且拦截证据都指向文本而非图片。
 */
export async function generateWithEnhancementFallback(
  generator: ImageGenerator,
  asset: { prompt: string; aspectRatio: ImageAspectRatio; type?: ImageAssetType },
  enhancements: GenerationEnhancements,
  model?: string
): Promise<GeneratedImagePayload> {
  const shared = {
    aspectRatio: asset.aspectRatio,
    ...referenceImagesField(enhancements),
    ...(model ? { model } : {})
  };
  // 两条分支的文本都先净化：降级路径直接发原文，不能漏。
  const rawPrompt = sanitizeImagePrompt(asset.prompt);
  const enhancedPrompt = sanitizeImagePrompt(
    composeEnhancedPrompt(asset.prompt, enhancements, { suppressText: asset.type === "storyboard" })
  );
  try {
    return await generator.generate({ prompt: enhancedPrompt, ...shared });
  } catch (error) {
    if (!enhancements.promptPrefix || !isContentBlockedError(error)) throw error;
    return await generator.generate({ prompt: rawPrompt, ...shared });
  }
}
