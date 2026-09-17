import {
  collectEnvExtraImageSites,
  isMaskedApiKey,
  providerSettingsPayloadSchema,
  toMaskedProviderSettings,
  withProviderOverrides,
  type ProviderOverrideValue,
  type ProviderSettingsPayload
} from "@/features/settings/provider-settings";
import { getWorkspaceEnv } from "@/server/config";
import { resetProviderAdapters } from "@/server/services";
import {
  loadProviderOverrides,
  loadProviderOverridesUpdatedAt,
  saveProviderOverrides
} from "@/server/settings-store";

export const runtime = "nodejs";

interface OverrideRow {
  value: ProviderOverrideValue | null;
  updatedAt: string | null;
}

/** 路由依赖（生产注入 settings-store + services 热生效钩子；测试注入内存实现）。 */
export interface ProvidersRouteDeps {
  loadRow: () => OverrideRow;
  saveRow: (value: ProviderOverrideValue | null) => string;
  getEnv: () => Record<string, string | undefined>;
  onConfigChanged: () => void;
}

export function createProvidersRouteHandler(deps: ProvidersRouteDeps) {
  const { loadRow, saveRow, getEnv, onConfigChanged } = deps;

  function maskedSettings() {
    const row = loadRow();
    const effectiveEnv = withProviderOverrides(getEnv(), row.value);
    return {
      updatedAt: row.updatedAt,
      settings: toMaskedProviderSettings(row.value, effectiveEnv)
    };
  }

  return {
    async GET() {
      return Response.json(maskedSettings());
    },

    async PUT(request: Request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
      }
      const parsed = providerSettingsPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: parsed.error.issues[0]?.message ?? "请求体格式无效" },
          { status: 400 }
        );
      }

      const row = loadRow();
      if (parsed.data.expectedUpdatedAt !== (row.updatedAt ?? "")) {
        return Response.json(
          { error: "配置已被其他窗口修改，请刷新后重试", updatedAt: row.updatedAt },
          { status: 409 }
        );
      }

      const env = getEnv();
      const existing = row.value ?? {};
      const payload = parsed.data as ProviderSettingsPayload;
      const next: ProviderOverrideValue = {
        llm: payload.llm !== undefined ? payload.llm : existing.llm ?? null,
        image: payload.image !== undefined ? payload.image : existing.image ?? null,
        extraImageSites:
          payload.extraImageSites !== undefined ? payload.extraImageSites : existing.extraImageSites ?? null
      };

      // 掩码 apiKey → 存量真值：先看覆盖行里存过的，再回落 env 当前真值。
      try {
        if (next.llm && isMaskedApiKey(next.llm.apiKey)) {
          const resolved = existing.llm?.apiKey ?? env.LLM_API_KEY ?? null;
          if (!resolved) {
            return Response.json(
              { error: "LLM 网关密钥显示为掩码且找不到已保存的真值，请重新输入完整密钥" },
              { status: 400 }
            );
          }
          next.llm = { ...next.llm, apiKey: resolved };
        }
        if (next.image && isMaskedApiKey(next.image.apiKey)) {
          const resolved = existing.image?.apiKey ?? env.IMAGE_API_KEY ?? null;
          if (!resolved) {
            return Response.json(
              { error: "生图站点密钥显示为掩码且找不到已保存的真值，请重新输入完整密钥" },
              { status: 400 }
            );
          }
          next.image = { ...next.image, apiKey: resolved };
        }
        if (next.extraImageSites) {
          // 掩码站点的存量真值：先查覆盖行，再按 baseUrl 匹配 env 里的站点
          //（按序号回落会错位——用户可能在面板里调整过站点顺序）。
          const envExtras = collectEnvExtraImageSites(env);
          next.extraImageSites = next.extraImageSites.map((site, index) => {
            if (!isMaskedApiKey(site.apiKey)) return site;
            const resolved =
              existing.extraImageSites?.[index]?.apiKey
              ?? envExtras.find((candidate) => candidate.baseUrl === site.baseUrl)?.apiKey;
            if (!resolved) {
              throw new Error(
                `第 ${index + 1} 个额外生图站点的密钥显示为掩码且找不到已保存的真值，请重新输入完整密钥`
              );
            }
            return { ...site, apiKey: resolved };
          });
        }
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "密钥解析失败" },
          { status: 400 }
        );
      }

      const empty = next.llm === null && next.image === null && next.extraImageSites === null;
      saveRow(empty ? null : next);
      onConfigChanged();
      return Response.json(maskedSettings());
    }
  };
}

export function createProvidersRouteDeps(): ProvidersRouteDeps {
  return {
    loadRow: () => ({ value: loadProviderOverrides(), updatedAt: loadProviderOverridesUpdatedAt() }),
    saveRow: saveProviderOverrides,
    getEnv: () => getWorkspaceEnv(),
    onConfigChanged: resetProviderAdapters
  };
}

export function GET() {
  return createProvidersRouteHandler(createProvidersRouteDeps()).GET();
}

export function PUT(request: Request) {
  return createProvidersRouteHandler(createProvidersRouteDeps()).PUT(request);
}
