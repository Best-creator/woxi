// 微信公众号草稿箱真实适配器（服务端专用）。
// 链路四步，顺序不可颠倒：
//   1. GET  /cgi-bin/token            AppID+AppSecret 换 access_token（2h，模块级缓存提前 2 分钟刷新）
//   2. POST /cgi-bin/material/add_material  封面 → 永久素材 → thumb_media_id（草稿必填）
//   3. POST /cgi-bin/media/uploadimg  正文图（≤1MB，超限先 sharp 压成 JPG）→ mmbiz.qpic.cn URL
//   4. POST /cgi-bin/draft/add        组装 articles[0] → media_id，草稿箱可见，发布人工完成
import sharp from "sharp";
import type {
  WechatDraftImage,
  WechatDraftInput,
  WechatDraftPublisher,
  WechatDraftResult
} from "./wechat-draft";
import { WechatDraftError, replaceImageUrls } from "./wechat-draft";

const API_BASE = "https://api.weixin.qq.com";
const CONTENT_IMAGE_MAX_BYTES = 1024 * 1024; // uploadimg 硬限制：1MB
const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;

export interface WechatCredentials {
  appId: string;
  appSecret: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** 清空 token 缓存（测试用；生产中 token 到期自动重取）。 */
export function resetWechatTokenCache() {
  tokenCache = null;
}

function readableWechatError(errcode: number, errmsg: string): WechatDraftError {
  if (errcode === 40001 || errcode === 40125 || errcode === 40013) {
    return new WechatDraftError("auth", "公众号凭据无效（AppID/AppSecret 错误），请检查配置");
  }
  if (errcode === 40164) {
    return new WechatDraftError(
      "auth",
      `本机公网 IP 不在公众号 IP 白名单内（${errmsg.slice(0, 120)}）。到公众号后台「设置与开发 → 基本配置 → IP 白名单」加入后重试`
    );
  }
  if (errcode === 48001) {
    return new WechatDraftError(
      "permission",
      "公众号没有草稿箱 API 权限（未认证账号不可调用）。可改用「复制到公众号」手动粘贴"
    );
  }
  if (errcode === 40007 || errcode === 40005 || errcode === 41005) {
    return new WechatDraftError("upload", `微信拒绝了媒体文件（${errcode}: ${errmsg.slice(0, 120)}）`);
  }
  return new WechatDraftError("invalid_input", `微信接口错误 ${errcode}: ${errmsg.slice(0, 160)}`);
}

async function parseWechatResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const errcode = typeof payload.errcode === "number" ? payload.errcode : 0;
  if (!response.ok) {
    throw new WechatDraftError("network", `微信接口 HTTP ${response.status}（${JSON.stringify(payload).slice(0, 160)}）`);
  }
  if (errcode !== 0) {
    throw readableWechatError(errcode, String(payload.errmsg ?? ""));
  }
  return payload;
}

async function fetchAccessToken(credentials: WechatCredentials): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(credentials.appId)}&secret=${encodeURIComponent(credentials.appSecret)}`;
  let payload: Record<string, unknown>;
  try {
    payload = await parseWechatResponse(await fetch(url, { signal: AbortSignal.timeout(15_000) }));
  } catch (error) {
    if (error instanceof WechatDraftError) throw error;
    throw new WechatDraftError("network", `获取 access_token 失败：${String((error as Error).message ?? error).slice(0, 160)}`);
  }
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 7200;
  if (!token) throw new WechatDraftError("auth", "微信未返回 access_token");
  tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS };
  return token;
}

/** 正文图压缩：超过 1MB 的位图一律转 JPG 逐档降质，直到满足限制（封面不在此列）。 */
export async function shrinkForContentImage(image: WechatDraftImage): Promise<{ data: Buffer; mimeType: string; filename: string }> {
  if (image.data.length <= CONTENT_IMAGE_MAX_BYTES) {
    return { data: image.data, mimeType: image.mimeType, filename: image.filename };
  }
  for (const quality of [85, 75, 60, 45]) {
    const jpeg = await sharp(image.data).jpeg({ quality }).toBuffer();
    if (jpeg.length <= CONTENT_IMAGE_MAX_BYTES || quality === 45) {
      return { data: jpeg, mimeType: "image/jpeg", filename: `${image.filename.replace(/\.[^.]+$/, "")}.jpg` };
    }
  }
  throw new WechatDraftError("upload", "正文图片压缩后仍超过微信 1MB 限制");
}

function toBlob(image: { data: Buffer; mimeType: string; filename: string }): File {
  return new File([new Uint8Array(image.data)], image.filename, { type: image.mimeType });
}

async function uploadCover(token: string, cover: WechatDraftImage): Promise<string> {
  const form = new FormData();
  form.set("media", toBlob({ data: cover.data, mimeType: cover.mimeType, filename: cover.filename }));
  let payload: Record<string, unknown>;
  try {
    payload = await parseWechatResponse(
      await fetch(`${API_BASE}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000)
      })
    );
  } catch (error) {
    if (error instanceof WechatDraftError) throw error;
    throw new WechatDraftError("upload", `封面图上传失败：${String((error as Error).message ?? error).slice(0, 160)}`);
  }
  const mediaId = typeof payload.media_id === "string" ? payload.media_id : "";
  if (!mediaId) throw new WechatDraftError("upload", "微信未返回封面素材 media_id");
  return mediaId;
}

async function uploadContentImage(token: string, image: WechatDraftImage): Promise<string> {
  const prepared = await shrinkForContentImage(image);
  const form = new FormData();
  form.set("media", toBlob(prepared));
  let payload: Record<string, unknown>;
  try {
    payload = await parseWechatResponse(
      await fetch(`${API_BASE}/cgi-bin/media/uploadimg?access_token=${token}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000)
      })
    );
  } catch (error) {
    if (error instanceof WechatDraftError) throw error;
    throw new WechatDraftError("upload", `正文图上传失败（${image.sourceUrl}）：${String((error as Error).message ?? error).slice(0, 120)}`);
  }
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!url) throw new WechatDraftError("upload", `微信未返回正文图 URL（${image.sourceUrl}）`);
  return url;
}

export class OfficialWechatDraftPublisher implements WechatDraftPublisher {
  constructor(private readonly credentials: WechatCredentials) {}

  async publish(input: WechatDraftInput): Promise<WechatDraftResult> {
    const token = await fetchAccessToken(this.credentials);
    const thumbMediaId = await uploadCover(token, input.cover);

    const replacements: Record<string, string> = {};
    for (const image of input.inlineImages) {
      replacements[image.sourceUrl] = await uploadContentImage(token, image);
    }
    const content = replaceImageUrls(input.contentHtml, replacements);

    const draftResponse = await fetch(`${API_BASE}/cgi-bin/draft/add?access_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        articles: [
          {
            title: input.title,
            ...(input.author ? { author: input.author } : {}),
            ...(input.digest ? { digest: input.digest } : {}),
            content,
            thumb_media_id: thumbMediaId,
            need_open_comment: 1,
            only_fans_can_comment: 0
          }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });
    const payload = await parseWechatResponse(draftResponse);
    const mediaId = typeof payload.media_id === "string" ? payload.media_id : "";
    if (!mediaId) throw new WechatDraftError("invalid_input", "微信未返回草稿 media_id");
    return { mediaId, imageReplacements: replacements };
  }
}
