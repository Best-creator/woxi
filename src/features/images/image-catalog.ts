import type { ProviderConfig } from "@/server/config";

/** 带展示名的生图站点（host 首段，如 image2 / yelan）。 */
export interface ImageSite extends ProviderConfig {
  name: string;
}

/** 生图模型目录条目：模型 id + 归属站点名。 */
export interface ImageCatalogEntry {
  id: string;
  provider: string;
}

/** 从站点 /v1/models 的 id 列表里挑出「像生图模型」的；收口成纯函数便于测试。 */
export function pickImageModels(ids: string[]): string[] {
  const hit = ids.filter((id) =>
    /image|img|flux|seed|dall|banana|draw|paint|diffusion|sd-|stable/i.test(id)
  );
  // 上游模型 id 大小写不稳定（GPT-Image-2 vs gpt-image-2），按小写键去重，保留首次出现的原样。
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of hit) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }
  return unique;
}

/**
 * 聚合多个生图站点的模型目录：
 * 并发请求各站 /v1/models，筛出生图模型并标记归属；同 id 主站优先；
 * 单站失败/超时只跳过该站，不拖垮整体。结果带模块级 TTL 缓存。
 */
export async function fetchImageCatalog(
  sites: ImageSite[],
  fetchFn: typeof fetch = fetch
): Promise<ImageCatalogEntry[]> {
  const results = await Promise.allSettled(
    sites.map(async (site): Promise<Array<{ site: ImageSite; ids: string[] }>> => {
      const response = await fetchFn(`${site.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${site.apiKey}` },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
      const ids = Array.isArray(payload.data)
        ? payload.data.filter((item): item is { id: string } => typeof item?.id === "string")
        : [];
      return [{ site, ids: ids.map((item) => item.id) }];
    })
  );

  const entries = new Map<string, string>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const [fulfilled] = result.value;
    if (!fulfilled) continue;
    for (const id of pickImageModels(fulfilled.ids)) {
      // 同名模型先到先得：sites[0] 是主站，享有优先权。
      const key = id.toLowerCase();
      if (!entries.has(key)) entries.set(key, fulfilled.site.name);
    }
  }
  return Array.from(entries, ([key, provider]) => ({
    id: hitOriginalId(key, results),
    provider
  }));
}

/** 目录里回填原始大小写的模型 id（results 顺序即站点优先级）。 */
function hitOriginalId(
  key: string,
  results: PromiseSettledResult<Array<{ site: ImageSite; ids: string[] }>>[]
): string {
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const original = result.value[0]?.ids.find((id) => id.toLowerCase() === key);
    if (original) return original;
  }
  return key;
}

/**
 * 解析模型归属站点：明确指定 model 时按目录查归属（目录缺失/未命中回落主站）；
 * 未指定时用主站默认模型。
 */
export function resolveImageSite(
  model: string | undefined,
  catalog: ImageCatalogEntry[],
  sites: ImageSite[]
): ImageSite {
  const main = sites[0];
  if (!model) return main;
  const owner = catalog.find((entry) => entry.id === model)?.provider;
  if (!owner) return main;
  return sites.find((site) => site.name === owner) ?? main;
}
