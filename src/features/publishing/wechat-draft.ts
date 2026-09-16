/**
 * 微信公众号草稿箱端口：把渲染好的图文推送到公众号草稿箱（不自动发布）。
 * 官方链路：access_token → 封面传永久素材（thumb_media_id）→ 正文图传 uploadimg
 * 换取 mmbiz.qpic.cn URL → POST /cgi-bin/draft/add。
 * 文档：developers.weixin.qq.com「草稿箱」；仅已认证订阅号/服务号可用。
 */

/** 正文内图片（来自本地上传或 AI 生成）。 */
export interface WechatDraftImage {
  /** HTML 中的原始图片地址（本地 content 路由或 https URL），作为替换定位键。 */
  sourceUrl: string;
  data: Buffer;
  mimeType: string;
  filename: string;
}

export interface WechatDraftInput {
  /** 文章标题；公众号限制 ≤64 字。 */
  title: string;
  /** 摘要；≤120 字，缺省由微信抓取正文前 54 字。 */
  digest?: string;
  /** 作者名；≤16 字。 */
  author?: string;
  /** 排版后的正文 HTML（图片地址会被替换成微信域 URL）。 */
  contentHtml: string;
  /** 封面图（必须；草稿 thumb_media_id 的来源）。 */
  cover: WechatDraftImage;
  /** 正文内引用的全部图片。 */
  inlineImages: WechatDraftImage[];
}

export interface WechatDraftResult {
  /** 草稿 media_id，可在公众号后台草稿箱看到；发布由人工在后台完成。 */
  mediaId: string;
  /** 正文图片「本地地址 → 微信地址」的映射（记录用）。 */
  imageReplacements: Record<string, string>;
}

export interface WechatDraftPublisher {
  publish(input: WechatDraftInput): Promise<WechatDraftResult>;
}

export class WechatDraftError extends Error {
  constructor(
    public readonly code:
      | "auth"           // AppID/Secret 无效或 IP 白名单未放行
      | "permission"     // 48001：账号无草稿箱 API 权限（未认证等）
      | "upload"         // 素材/正文图上传失败
      | "invalid_input"  // 微信校验拒绝（标题超限、正文含外部图片等）
      | "network",       // 网络层失败
    message: string
  ) {
    super(message);
    this.name = "WechatDraftError";
  }
}

/**
 * 把 HTML 里的本地图片地址替换成上传后的微信域 URL。
 * 纯函数：映射来自 uploadimg 的返回；只替换精确命中的地址，其余内容原样保留。
 */
export function replaceImageUrls(html: string, mapping: Record<string, string>): string {
  let output = html;
  for (const [from, to] of Object.entries(mapping)) {
    // replaceAll 按 key 全字替换；key 是完整 URL（/api/... 或 https://...），无正则歧义
    output = output.split(from).join(to);
  }
  return output;
}
