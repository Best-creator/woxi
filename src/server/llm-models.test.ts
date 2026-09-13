import { describe, expect, it, vi } from "vitest";
import { parseServerConfig } from "./config";
import { discoverLlmModels, getPublicLlmConfigWithDiscovery, pickPreferredModel } from "./llm-models";

const config = {
  baseUrl: "https://llm.example.test",
  apiKey: "secret",
  model: "grok-4.6",
  availableModels: ["grok-4.6"],
  researchModel: "",
  reviewModel: "",
  visualModel: ""
};

describe("LLM model discovery", () => {
  it("reads and deduplicates OpenAI-compatible model ids", async () => {
    const fetchFn = vi.fn(async () => Response.json({
      data: [
        { id: "grok-4.6" },
        { id: "gemini-2.5-pro" },
        { id: "gemini-2.5-pro" },
        { id: "" }
      ]
    }));

    await expect(discoverLlmModels(config, fetchFn)).resolves.toEqual([
      "grok-4.6",
      "gemini-2.5-pro"
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://llm.example.test/v1/models",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("prefers the highest available Gemini model", () => {
    expect(pickPreferredModel([
      "grok-4.6",
      "gemini-2.0-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash"
    ])).toBe("gemini-2.5-pro");
  });

  it("rejects upstream failures without exposing response data", async () => {
    const fetchFn = vi.fn(async () => new Response("private upstream detail", { status: 500 }));
    await expect(discoverLlmModels(config, fetchFn, { force: true })).rejects.toMatchObject({ code: "upstream" });
  });

  it("makes discovered models available to later LLM requests", async () => {
    const baseUrl = "https://dynamic-models.example.test";
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "gemini-3.0-pro" }] }));

    await discoverLlmModels({ ...config, baseUrl }, fetchFn);

    expect(parseServerConfig({
      LLM_BASE_URL: baseUrl,
      LLM_API_KEY: "secret",
      LLM_MODEL: "grok-4.6"
    }).llm?.availableModels).toEqual(expect.arrayContaining(["grok-4.6", "gemini-3.0-pro"]));
  });

  it("serves repeated discovery from the TTL cache", async () => {
    const baseUrl = "https://cached-models.example.test";
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "cached-model" }] }));
    await discoverLlmModels({ ...config, baseUrl }, fetchFn);

    await expect(discoverLlmModels({ ...config, baseUrl }, fetchFn)).resolves.toEqual(["cached-model"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when force is requested", async () => {
    const baseUrl = "https://forced-models.example.test";
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "forced-model" }] }));
    await discoverLlmModels({ ...config, baseUrl }, fetchFn);

    await expect(discoverLlmModels({ ...config, baseUrl }, fetchFn, { force: true })).resolves.toEqual(["forced-model"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rediscovers after the cache expires", async () => {
    const baseUrl = "https://expiring-models.example.test";
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "model-a" }] }));
    await discoverLlmModels({ ...config, baseUrl }, fetchFn);

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    try {
      await expect(discoverLlmModels({ ...config, baseUrl }, fetchFn)).resolves.toEqual(["model-a"]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      dateSpy.mockRestore();
    }
  });
});

describe("getPublicLlmConfigWithDiscovery", () => {
  it("keeps the configured primary model as default while expanding available models", async () => {
    const baseUrl = "https://public-config.example.test";
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: "a-model" }, { id: "b-model" }] }));

    const result = await getPublicLlmConfigWithDiscovery({
      databasePath: ":memory:",
      llm: { ...config, baseUrl },
      image: null
    }, fetchFn);

    expect(result).toEqual({
      enabled: true,
      availableModels: ["a-model", "b-model"],
      defaultModel: "grok-4.6"
    });
  });

  it("falls back to the env-configured model list when discovery fails", async () => {
    const fetchFn = vi.fn(async () => new Response("upstream down", { status: 500 }));

    const result = await getPublicLlmConfigWithDiscovery({
      databasePath: ":memory:",
      llm: { ...config, baseUrl: "https://fallback-config.example.test" },
      image: null
    }, fetchFn);

    expect(result).toEqual({
      enabled: true,
      availableModels: ["grok-4.6"],
      defaultModel: "grok-4.6"
    });
  });

  it("reports a disabled provider without an LLM configuration", async () => {
    const result = await getPublicLlmConfigWithDiscovery({
      databasePath: ":memory:",
      llm: null,
      image: null
    });

    expect(result).toEqual({ enabled: false, availableModels: [], defaultModel: null });
  });
});
