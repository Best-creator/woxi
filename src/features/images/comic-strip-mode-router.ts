import { z } from "zod";
import type { OpenAiJsonClient } from "@/features/llm/openai-json-client";
import { COMIC_STRIP_MODES, type ComicStripMode } from "./domain";

/**
 * 拼图排法路由：读正文与分镜特征，替用户决定这张长图用哪种排法。
 *
 * 三种排法的适配场景写在提示词里，给模型判断依据：
 * - image_text（图 + 文）：一格一图、文案跟在图后。适合文案偏长、需要读完再看的段落。
 * - text_image（文 + 图）：文案在上、图在下。适合先铺垫再揭示画面的叙事。
 * - image_text_image（图 + 文 + 图）：分镜两两成组、文案落在两图正中间。适合文案短、
 *   格数偏偶数、想要连环画式节奏的内容。
 */

export interface ComicStripModeDecision {
  mode: ComicStripMode;
  /** 一句给用户看的理由；自动决策时展示在工作台上。 */
  reason: string;
}

export interface ComicStripModePanelSummary {
  /** 这一格的标题（段落没有标题时为 null）。 */
  title: string | null;
  /** 这一格的文案。 */
  caption: string;
  /** 文案字数（去空白后）。 */
  chars: number;
}

export interface DecideComicStripModeInput {
  panels: ComicStripModePanelSummary[];
  /** 正文节选（开头若干字），供模型判断整篇的叙事气质。 */
  excerpt: string;
}

export interface ComicStripModeRouter {
  decide(input: DecideComicStripModeInput): Promise<ComicStripModeDecision>;
}

/** 确定性回落规则：也是无 LLM 配置时的正式实现（E2E 依赖它的稳定）。 */
export function heuristicComicStripMode(input: DecideComicStripModeInput): ComicStripModeDecision {
  const panelCount = input.panels.length;
  const totalChars = input.panels.reduce((total, panel) => total + panel.chars, 0);
  const averageChars = panelCount > 0 ? totalChars / panelCount : 0;

  if (averageChars <= 70 && panelCount % 2 === 0) {
    return {
      mode: "image_text_image",
      reason: `每格文案平均 ${Math.round(averageChars)} 字、${panelCount} 格两两成组，适合连环画节奏`
    };
  }
  if (averageChars > 110) {
    return {
      mode: "text_image",
      reason: `每格文案平均 ${Math.round(averageChars)} 字偏长，先读文案再看图更顺`
    };
  }
  return {
    mode: "image_text",
    reason: `每格文案平均 ${Math.round(averageChars)} 字、${panelCount} 格，图上文下最自然`
  };
}

/** 无 LLM 配置时的正式路由器：直接走确定性规则。 */
export class HeuristicComicStripModeRouter implements ComicStripModeRouter {
  async decide(input: DecideComicStripModeInput): Promise<ComicStripModeDecision> {
    return heuristicComicStripMode(input);
  }
}

const decisionSchema = z.object({
  mode: z.enum(COMIC_STRIP_MODES),
  reason: z.string().trim().min(1).max(200)
});

const MODE_ROUTER_SYSTEM_PROMPT = `你是漫画排版的排版师。根据输入的分镜与正文信息，从三种排法里选一种最适合的：
- image_text（图 + 文）：一格一图，文案跟在这格图后面。适合文案偏长、信息密度高的内容。
- text_image（文 + 图）：文案在上、图在下。适合先铺垫说明、再揭示画面的叙事。
- image_text_image（图 + 文 + 图）：分镜两两成组，文案落在两张图正中间。适合文案短、格数为偶数、节奏像连环画的内容。
只返回 JSON：{"mode":"image_text|text_image|image_text_image","reason":"不超过 60 字的选择理由，说给作者看"}`;

/** 真实模型路由：失败时抛错，由调用方回落到确定性规则，不让排版卡死在模型上。 */
export class OpenAiComicStripModeRouter implements ComicStripModeRouter {
  constructor(
    private readonly client: Pick<OpenAiJsonClient, "complete">,
    private readonly model?: string
  ) {}

  async decide(input: DecideComicStripModeInput): Promise<ComicStripModeDecision> {
    const result = await this.client.complete({
      model: this.model,
      systemPrompt: MODE_ROUTER_SYSTEM_PROMPT,
      userPayload: {
        panels: input.panels,
        excerpt: input.excerpt
      },
      schema: decisionSchema,
      timeoutMs: 60_000
    });
    // 客户端已按 schema 校验过；这里再解析一次，路由契约不依赖客户端的实现细节。
    const decision = decisionSchema.parse(result);
    return { mode: decision.mode, reason: decision.reason };
  }
}
