import { describe, expect, it } from "vitest";
import { getPublicLlmConfig, parseServerConfig, toPublicLlmConfig } from "./config";

describe("parseServerConfig", () => {
  it("keeps external providers disabled when keys are empty", () => {
    const config = parseServerConfig({
      LLM_BASE_URL: "https://yelan.xiaobupao.cn",
      LLM_API_KEY: "",
      IMAGE_BASE_URL: "https://image2.xiaobupao.cn",
      IMAGE_API_KEY: ""
    });
    expect(config.llm).toBeNull();
    expect(config.image).toBeNull();
    expect(config.databasePath).toBe(".data/content-platform.db");
  });

  it("returns a server-only LLM configuration", () => {
    expect(parseServerConfig({
      LLM_BASE_URL: "https://yelan.xiaobupao.cn",
      LLM_API_KEY: "secret",
      LLM_MODEL: "gpt-5.6-terra",
      LLM_MODELS: "gpt-5.6-terra, gpt-5.6-sol, gpt-5.6-terra"
    }).llm).toEqual({
      baseUrl: "https://yelan.xiaobupao.cn",
      apiKey: "secret",
      model: "gpt-5.6-terra",
      availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"]
    });
  });

  it("deduplicates configured LLM models and includes the default model", () => {
    expect(parseServerConfig({
      LLM_API_KEY: "secret",
      LLM_MODEL: "gpt-5.6-terra",
      LLM_MODELS: "gpt-5.6-sol, gpt-5.6-sol"
    }).llm?.availableModels).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("allows model discovery when an LLM key is configured without a fixed model", () => {
    expect(parseServerConfig({ LLM_API_KEY: "secret", LLM_MODEL: "" }).llm)
      .toMatchObject({ apiKey: "secret", model: "", availableModels: [] });
  });
});

describe("public LLM configuration", () => {
  it("does not expose provider credentials or endpoint", () => {
    const config = parseServerConfig({
      LLM_BASE_URL: "https://private.example.test",
      LLM_API_KEY: "secret",
      LLM_MODEL: "gpt-5.6-terra"
    });

    expect(toPublicLlmConfig(config)).toEqual({
      enabled: true,
      availableModels: ["gpt-5.6-terra"],
      defaultModel: "gpt-5.6-terra"
    });
    expect(toPublicLlmConfig(config)).not.toHaveProperty("apiKey");
    expect(toPublicLlmConfig(config)).not.toHaveProperty("baseUrl");
  });

  it("reports a disabled LLM when no key is configured", () => {
    expect(toPublicLlmConfig(parseServerConfig({}))).toEqual({
      enabled: false,
      availableModels: [],
      defaultModel: null
    });
  });

  it("gets public configuration from the server environment", () => {
    const publicConfig = getPublicLlmConfig();
    expect(publicConfig).toMatchObject({
      enabled: expect.any(Boolean),
      availableModels: expect.any(Array)
    });
    expect(publicConfig.defaultModel === null || typeof publicConfig.defaultModel === "string").toBe(true);
    expect(publicConfig).not.toHaveProperty("apiKey");
    expect(publicConfig).not.toHaveProperty("baseUrl");
  });
});
