import type { ImageAspectRatio } from "./domain";

/**
 * 生成一张图的结果：
 * - remoteUrl：上游返回的持久 CDN 链接，可能不存在；
 * - binary：图片二进制（b64_json 解码），上游只回链接时为 null；
 * 两者至少要有一个，否则视为上游无效响应。
 */
export interface GeneratedImagePayload {
  remoteUrl: string | null;
  binary: Buffer | null;
  format: string;
}

export interface ImageGeneratorInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
}

export interface ImageGenerator {
  generate(input: ImageGeneratorInput): Promise<GeneratedImagePayload>;
}

export class ImageGeneratorError extends Error {
  constructor(
    public readonly code: "timeout" | "authentication" | "invalid_response" | "upstream",
    message: string
  ) {
    super(message);
    this.name = "ImageGeneratorError";
  }
}

const sizeByAspectRatio: Record<ImageAspectRatio, "1536x1024" | "1024x1024" | "1024x1536"> = {
  // 封面 2.35:1 与横图 3:2 都取上游支持的最宽横版，展示端再按容器裁切。
  cover: "1536x1024",
  landscape: "1536x1024",
  square: "1024x1024",
  portrait: "1024x1536"
};

export function sizeForAspectRatio(aspectRatio: ImageAspectRatio) {
  return sizeByAspectRatio[aspectRatio];
}
