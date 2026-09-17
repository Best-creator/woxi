// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverLlmModels: vi.fn(),
  loadProviderOverrides: vi.fn(),
  env: { LLM_API_KEY: "env-llm-truth", IMAGE_API_KEY: "env-image-truth" } as Record<string, string | undefined>
}));

vi.mock("@/server/llm-models", () => ({
  discoverLlmModels: mocks.discoverLlmModels
}));

vi.mock("@/server/settings-store", () => ({
  loadProviderOverrides: mocks.loadProviderOverrides
}));

vi.mock("@/server/config", () => ({
  getWorkspaceEnv: () => mocks.env
}));

import { POST } from "./route";

function testRequest(body: unknown) {
  return new Request("http://localhost/api/settings/providers/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("provider connection test route", () => {
  beforeEach(() => {
    mocks.discoverLlmModels.mockReset();
    mocks.loadProviderOverrides.mockReset();
    mocks.loadProviderOverrides.mockReturnValue(null);
  });

  it("probes the gateway and returns the discovered models", async () => {
    mocks.discoverLlmModels.mockResolvedValue(["grok-4.6", "glm-5.3-flash"]);
    const response = await POST(testRequest({
      scope: "llm",
      baseUrl: "https://llm.example.test",
      apiKey: "sk-live"
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, models: ["grok-4.6", "glm-5.3-flash"] });
    expect(mocks.discoverLlmModels.mock.calls[0][0]).toMatchObject({
      baseUrl: "https://llm.example.test",
      apiKey: "sk-live"
    });
  });

  it("resolves masked keys against the saved override truth", async () => {
    mocks.loadProviderOverrides.mockReturnValue({
      llm: { baseUrl: "https://llm.example.test", apiKey: "panel-truth", model: "m", models: "", researchModel: "", reviewModel: "", visualModel: "", visionModel: "" }
    });
    const response = await POST(testRequest({
      scope: "llm",
      baseUrl: "https://llm.example.test",
      apiKey: "••••truth"
    }));

    expect(response.status).toBe(200);
    expect(mocks.discoverLlmModels.mock.calls[0][0]).toMatchObject({ apiKey: "panel-truth" });
  });

  it("falls back to the env truth for masked image keys", async () => {
    const response = await POST(testRequest({
      scope: "image",
      baseUrl: "https://image.example.test",
      apiKey: "••••truth"
    }));

    expect(response.status).toBe(200);
    expect(mocks.discoverLlmModels.mock.calls[0][0]).toMatchObject({ apiKey: "env-image-truth" });
  });

  it("maps upstream failures to a 502 with the provider message", async () => {
    const { LlmError } = await import("@/features/llm/errors");
    mocks.discoverLlmModels.mockRejectedValue(new LlmError("authentication", "语言模型服务认证失败，请检查服务配置。"));
    const response = await POST(testRequest({
      scope: "llm",
      baseUrl: "https://llm.example.test",
      apiKey: "sk-live"
    }));

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toContain("认证失败");
  });

  it("validates the request body", async () => {
    const response = await POST(testRequest({ scope: "llm", baseUrl: "nope" }));
    expect(response.status).toBe(400);
  });
});
