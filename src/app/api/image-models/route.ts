import { getImageModelCatalog } from "@/server/services";
import { getServerConfig } from "@/server/config";

export const runtime = "nodejs";

/**
 * 生图模型目录：聚合所有已配置站点（IMAGE_* 主站 + IMAGE2_* 额外站）的生图模型，
 * 附默认模型。单站失败自动跳过；TTL 10 分钟缓存。
 */
export async function GET() {
  const config = getServerConfig();
  if (!config.image) {
    return Response.json({ models: [], defaultModel: null });
  }
  const models = await getImageModelCatalog();
  return Response.json({
    models,
    defaultModel: config.image.model
  });
}
