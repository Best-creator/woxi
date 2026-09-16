import type { GeneratedImagePayload } from "./image-generator";
import { ImageGeneratorError, sizeForAspectRatio } from "./image-generator";
import type { ImageGenerator, ImageGeneratorInput } from "./image-generator";
import type { ImageSite } from "./image-catalog";
import { resolveImageSite } from "./image-catalog";

const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
const COOLDOWN_MAX_ATTEMPTS = 3;

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

interface UpstreamImageItem {
  url?: unknown;
  b64_json?: unknown;
  output_format?: unknown;
}

/** 从上游错误响应体里提取人类可读的原因（截断，避免刷屏）。 */
async function upstreamReason(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
      const message = parsed.error?.message ?? parsed.message;
      if (typeof message === "string" && message.trim()) return message.trim();
    } catch {
      // 非 JSON 错误体，原样截断展示
    }
    return text.trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export class OpenAiImageGenerator implements ImageGenerator {
  constructor(
    /** 生图站点清单；sites[0] 为主站（默认模型归属）。 */
    private readonly sites: ImageSite[],
    private readonly fetchFn: typeof fetch = fetch,
    /** 模型目录（可选）：跨站选模型时用于解析归属站点。 */
    private readonly catalog: () => Promise<
      Array<{ id: string; provider: string }>
    > = async () => []
  ) {}

  async generate(input: ImageGeneratorInput): Promise<GeneratedImagePayload> {
    // 429 冷却重试：读 reset_seconds 等待后重试，最多 3 次。
    let lastError: ImageGeneratorError | null = null;
    for (let attempt = 1; attempt <= COOLDOWN_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.attempt(input);
      } catch (error) {
        if (!(error instanceof ImageGeneratorError)) throw error;
        lastError = error;
        const cooldown = error.cooldownSeconds;
        if (cooldown === null || attempt === COOLDOWN_MAX_ATTEMPTS) throw error;
        await new Promise((resolveTick) => setTimeout(resolveTick, Math.min(cooldown, 60) * 1000));
      }
    }
    throw lastError;
  }

  private async attempt(input: ImageGeneratorInput): Promise<GeneratedImagePayload> {
    const model = input.model || this.sites[0].model;
    let site = this.sites.find((candidate) => candidate.model === model) ?? this.sites[0];
    if (this.sites.length > 1 && site === this.sites[0] && input.model) {
      // 模型不是任何站的默认模型：查目录解析归属（查不到回落主站，由上游报错）。
      site = resolveImageSite(model, await this.catalog(), this.sites);
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${site.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${site.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size: sizeForAspectRatio(input.aspectRatio),
          n: 1,
          // 强制内联返回 base64：部分网关的图床域名（url 指向的文件服务）
          // 从用户网络不可达，内联数据可直接落盘并经本地 content 路由分发。
          response_format: "b64_json"
        }),
        signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS)
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new ImageGeneratorError("timeout", "图片生成响应超时，请稍后重试。");
      }
      throw new ImageGeneratorError(
        "upstream",
        `图片生成服务暂时不可用（${(error as Error).message || "网络错误"}），请稍后重试。`
      );
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ImageGeneratorError("authentication", "图片生成服务认证失败，请检查服务配置。");
      }
      if (response.status === 429) {
        const reason = await upstreamReason(response);
        const seconds = parseResetSeconds(reason);
        throw new ImageGeneratorError(
          "upstream",
          seconds !== null
            ? `生图模型 ${model} 冷却中，约 ${seconds} 秒后可重试。`
            : `生图模型 ${model} 请求过于频繁：${reason}`,
          seconds
        );
      }
      const reason = await upstreamReason(response);
      throw new ImageGeneratorError(
        "upstream",
        `图片生成服务返回错误（${reason}）。可尝试在生成按钮旁切换其他模型。`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ImageGeneratorError("invalid_response", "图片生成服务返回了无效结果。");
    }

    const items = (payload as { data?: unknown })?.data;
    const item = Array.isArray(items) ? (items[0] as UpstreamImageItem | undefined) : undefined;
    const remoteUrl = typeof item?.url === "string" && item.url ? item.url : null;
    const base64 = typeof item?.b64_json === "string" && item.b64_json ? item.b64_json : null;
    if (!remoteUrl && !base64) {
      throw new ImageGeneratorError("invalid_response", "图片生成服务返回了无效结果。");
    }

    const format =
      typeof item?.output_format === "string" && item.output_format
        ? item.output_format
        : "png";

    let binary: Buffer | null = null;
    if (base64) {
      binary = Buffer.from(base64, "base64");
      if (binary.length === 0) binary = null;
    }
    if (!remoteUrl && !binary) {
      throw new ImageGeneratorError("invalid_response", "图片生成服务返回了无效结果。");
    }

    return { remoteUrl, binary, format };
  }
}

function parseResetSeconds(reason: string): number | null {
  const match = reason.match(/reset_seconds["']?\s*[:=]\s*"?(\d+)/);
  return match ? Number(match[1]) : null;
}
