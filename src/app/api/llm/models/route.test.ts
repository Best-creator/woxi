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
  ...(await vi.importActual<typeof import("@/server/config")>("@/server/config")),
  getServerConfig: () => state.config
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
