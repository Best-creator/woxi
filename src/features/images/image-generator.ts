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

/** 图生图参考图：data 为原始二进制，mimeType 如 image/png。 */
export interface ReferenceImage {
  data: Buffer;
  mimeType: string;
}

export interface ImageGeneratorInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /** 生图模型 id；缺省用服务端配置的默认模型。跨站模型由服务端按目录路由。 */
  model?: string;
  /**
   * 参考形象图（图生图）：非空时适配器优先走 /v1/images/edits（multipart 文件字段），
   * 渠道不可用再降级 /v1/images/generations + image data URL 数组。
   */
  referenceImages?: ReferenceImage[];
}

export interface ImageGenerator {
  generate(input: ImageGeneratorInput): Promise<GeneratedImagePayload>;
}

export class ImageGeneratorError extends Error {
  constructor(
    public readonly code: "timeout" | "authentication" | "invalid_response" | "upstream",
    message: string,
    /** 上游 429 且给出 reset_seconds 时的冷却秒数；其余为 null。 */
    public readonly cooldownSeconds: number | null = null
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
