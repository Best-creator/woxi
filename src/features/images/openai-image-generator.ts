import type { ProviderConfig } from "@/server/config";
import type { GeneratedImagePayload } from "./image-generator";
import { ImageGeneratorError, sizeForAspectRatio } from "./image-generator";
import type { ImageGenerator, ImageGeneratorInput } from "./image-generator";

const IMAGE_GENERATION_TIMEOUT_MS = 180_000;

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

interface UpstreamImageItem {
  url?: unknown;
  b64_json?: unknown;
  output_format?: unknown;
}

export class OpenAiImageGenerator implements ImageGenerator {
  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async generate(input: ImageGeneratorInput): Promise<GeneratedImagePayload> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
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
      throw new ImageGeneratorError("upstream", "图片生成服务暂时不可用，请稍后重试。");
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ImageGeneratorError("authentication", "图片生成服务认证失败，请检查服务配置。");
      }
      throw new ImageGeneratorError("upstream", "图片生成服务暂时不可用，请稍后重试。");
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
