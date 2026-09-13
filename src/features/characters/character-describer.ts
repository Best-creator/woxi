export interface CharacterDescribeInput {
  /** 参考图的 data URL（data:image/png;base64,...）。 */
  imageDataUrl: string;
  /** 覆盖视觉模型；缺省时用服务端默认（LLM_VISION_MODEL 或主模型）。 */
  model?: string;
}

export interface CharacterDescriber {
  describe(input: CharacterDescribeInput): Promise<string>;
}

export class CharacterDescribeError extends Error {
  constructor(
    public readonly code: "timeout" | "authentication" | "upstream" | "invalid_response",
    message: string
  ) {
    super(message);
    this.name = "CharacterDescribeError";
  }
}
