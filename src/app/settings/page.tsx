import { ProviderSettingsPanel } from "@/components/provider-settings-panel";
import {
  toMaskedProviderSettings,
  withProviderOverrides
} from "@/features/settings/provider-settings";
import { getWorkspaceEnv } from "@/server/config";
import {
  loadProviderOverrides,
  loadProviderOverridesUpdatedAt
} from "@/server/settings-store";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const overrides = loadProviderOverrides();
  const env = getWorkspaceEnv();
  const settings = toMaskedProviderSettings(overrides, withProviderOverrides(env, overrides));

  return (
    <ProviderSettingsPanel
      initialSettings={settings}
      initialUpdatedAt={loadProviderOverridesUpdatedAt()}
    />
  );
}
