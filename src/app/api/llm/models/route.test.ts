import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: {
    llm: {
      baseUrl: "https://llm.example.test",
      apiKey: "secret",
      model: "grok-4.6",
      availableModels: ["grok-4.6"]
    }
  }
}));

vi.mock("@/server/config", async () => ({
  // config 保留真实实现，但 mock 掉它的 settings-store 依赖（node:sqlite 无法被
  // jsdom 环境打包）——覆盖层读取按「无覆盖行」处理，getServerConfig 返回测试配置。
  ...(await vi.importActual<typeof import("@/server/config")>("@/server/config")),
  getServerConfig: () => state.config
}));

vi.mock("@/server/settings-store", () => ({
  loadProviderOverrides: () => null,
  loadProviderOverridesUpdatedAt: () => null,
  saveProviderOverrides: () => ""
}));

describe("GET /api/llm/models", () => {
  it("returns discovered models without credentials", async () => {
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "gemini-2.5-pro" }] }));
    vi.stubGlobal("fetch", fetchFn);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      models: ["gemini-2.5-pro"],
      defaultModel: "gemini-2.5-pro",
      enabled: true
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});
