import { describe, expect, it } from "vitest";
import {
  collectEnvExtraImageSites,
  imageSettingsToEnv,
  isMaskedApiKey,
  llmSettingsToEnv,
  maskApiKey,
  parseProviderOverrideJson,
  requireStorableApiKey,
  toMaskedProviderSettings,
  withProviderOverrides,
  type ImageSettings,
  type LlmSettings
} from "./provider-settings";

const llmSettings: LlmSettings = {
  baseUrl: "https://llm.example.test",
  apiKey: "llm-secret-12345678",
  model: "grok-4.6",
  models: "glm-5.3-flash, grok-4.20-multi",
  researchModel: "grok-4.20-multi",
  reviewModel: "glm-5.3-flash",
  visualModel: "glm-5.3-flash",
  visionModel: "grok-4.6"
};

const imageSettings: ImageSettings = {
  baseUrl: "https://image.example.test",
  apiKey: "image-secret-87654321",
  model: "gpt-image-2"
};

describe("maskApiKey", () => {
  it("keeps only the trailing 4 characters", () => {
    expect(maskApiKey("llm-secret-12345678")).toBe("••••5678");
  });

  it("hides short keys entirely", () => {
    expect(maskApiKey("abc")).toBe("••••");
    expect(maskApiKey("abcd")).toBe("••••");
  });

  it("marks masked values so submissions can be told apart", () => {
    expect(isMaskedApiKey(maskApiKey("any-key-value"))).toBe(true);
    expect(isMaskedApiKey("sk-live-real-key")).toBe(false);
  });
});

describe("requireStorableApiKey", () => {
  it("passes through freshly typed keys", () => {
    expect(requireStorableApiKey("sk-new-key", null, "LLM")).toBe("sk-new-key");
  });

  it("resolves masked submissions against the stored value", () => {
    expect(requireStorableApiKey("••••5678", "llm-secret-12345678", "LLM")).toBe("llm-secret-12345678");
  });

  it("rejects masked submissions when no stored value exists", () => {
    expect(() => requireStorableApiKey("••••5678", null, "LLM 网关"))
      .toThrow(/重新输入完整密钥/);
  });
});

describe("settings → env keys", () => {
  it("maps LLM settings onto the full LLM_* key family", () => {
    expect(llmSettingsToEnv(llmSettings)).toEqual({
      LLM_BASE_URL: "https://llm.example.test",
      LLM_API_KEY: "llm-secret-12345678",
      LLM_MODEL: "grok-4.6",
      LLM_MODELS: "glm-5.3-flash, grok-4.20-multi",
      LLM_RESEARCH_MODEL: "grok-4.20-multi",
      LLM_REVIEW_MODEL: "glm-5.3-flash",
      LLM_VISUAL_MODEL: "glm-5.3-flash",
      LLM_VISION_MODEL: "grok-4.6"
    });
  });

  it("maps the main image site without an index prefix", () => {
    expect(imageSettingsToEnv(imageSettings)).toEqual({
      IMAGE_BASE_URL: "https://image.example.test",
      IMAGE_API_KEY: "image-secret-87654321",
      IMAGE_MODEL: "gpt-image-2"
    });
  });

  it("maps extra sites onto IMAGE2_/IMAGE3_/… prefixes", () => {
    expect(Object.keys(imageSettingsToEnv(imageSettings, 0))).toEqual([
      "IMAGE2_BASE_URL", "IMAGE2_API_KEY", "IMAGE2_MODEL"
    ]);
    expect(Object.keys(imageSettingsToEnv(imageSettings, 1))).toEqual([
      "IMAGE3_BASE_URL", "IMAGE3_API_KEY", "IMAGE3_MODEL"
    ]);
  });
});

describe("withProviderOverrides", () => {
  const env = {
    CONTENT_DB_PATH: ".data/x.db",
    LLM_API_KEY: "env-llm-key",
    LLM_MODEL: "env-llm-model",
    LLM_RESEARCH_MODEL: "env-research",
    IMAGE_BASE_URL: "https://env-image.example.test",
    IMAGE_API_KEY: "env-image-key",
    IMAGE_MODEL: "env-image-model",
    IMAGE2_BASE_URL: "https://env-extra.example.test",
    IMAGE2_API_KEY: "env-extra-key",
    IMAGE2_MODEL: "grok-image"
  };

  it("returns the env copy untouched without overrides", () => {
    const merged = withProviderOverrides(env, null);
    expect(merged).toEqual(env);
  });

  it("leaves a provider family on env defaults when its override is null", () => {
    const merged = withProviderOverrides(env, { llm: null, image: null, extraImageSites: null });
    expect(merged.LLM_API_KEY).toBe("env-llm-key");
    expect(merged.IMAGE_API_KEY).toBe("env-image-key");
    expect(merged.IMAGE2_API_KEY).toBe("env-extra-key");
  });

  it("takes over the whole LLM family when an override is present", () => {
    const merged = withProviderOverrides(env, {
      llm: llmSettings,
      image: null,
      extraImageSites: null
    });
    expect(merged.LLM_BASE_URL).toBe("https://llm.example.test");
    expect(merged.LLM_API_KEY).toBe("llm-secret-12345678");
    expect(merged.LLM_RESEARCH_MODEL).toBe("grok-4.20-multi");
    // 未在表单出现过的旧 env LLM 键不得残留
    expect(merged.LLM_MODEL).toBe("grok-4.6");
    expect(Object.keys(merged).filter((key) => key.startsWith("LLM_"))).toHaveLength(8);
    // 其他键族不受影响
    expect(merged.IMAGE_API_KEY).toBe("env-image-key");
    expect(merged.IMAGE2_API_KEY).toBe("env-extra-key");
  });

  it("overrides the main image site only when provided", () => {
    const merged = withProviderOverrides(env, { image: imageSettings });
    expect(merged.IMAGE_API_KEY).toBe("image-secret-87654321");
    expect(merged.LLM_API_KEY).toBe("env-llm-key");
    expect(merged.IMAGE2_API_KEY).toBe("env-extra-key");
  });

  it("clears env extra sites when an empty site list is saved", () => {
    const merged = withProviderOverrides(env, { extraImageSites: [] });
    expect(merged.IMAGE2_BASE_URL).toBeUndefined();
    expect(merged.IMAGE2_API_KEY).toBeUndefined();
    expect(merged.IMAGE_BASE_URL).toBe("https://env-image.example.test");
  });

  it("replaces all extra sites with the saved list in order", () => {
    const merged = withProviderOverrides(env, {
      extraImageSites: [imageSettings, { ...imageSettings, baseUrl: "https://second.example.test" }]
    });
    expect(merged.IMAGE2_BASE_URL).toBe("https://image.example.test");
    expect(merged.IMAGE3_BASE_URL).toBe("https://second.example.test");
    expect(merged.IMAGE2_API_KEY).toBe("image-secret-87654321");
  });

  it("does not treat IMAGE_BASE_URL as an extra-site key", () => {
    const merged = withProviderOverrides(env, { extraImageSites: [] });
    expect(merged.IMAGE_BASE_URL).toBe("https://env-image.example.test");
  });
});

describe("collectEnvExtraImageSites", () => {
  it("collects keyed groups in numeric order and skips keyless groups", () => {
    const sites = collectEnvExtraImageSites({
      IMAGE_MODEL: "fallback-model",
      IMAGE3_BASE_URL: "https://third.example.test",
      IMAGE3_API_KEY: "third-key",
      IMAGE2_BASE_URL: "https://second.example.test",
      IMAGE2_MODEL: "second-model",
      // 缺 apiKey 的组与 config.ts 一致：整组跳过（不认这个站点）
      IMAGE4_BASE_URL: "https://fourth.example.test",
      IMAGE4_MODEL: "fourth-model"
    });
    expect(sites).toEqual([
      { baseUrl: "https://third.example.test", apiKey: "third-key", model: "fallback-model" }
    ]);
  });
});

describe("toMaskedProviderSettings", () => {
  const fullEnv = {
    LLM_BASE_URL: "https://env-llm.example.test",
    LLM_API_KEY: "env-llm-key-1111",
    LLM_MODEL: "env-model",
    IMAGE_API_KEY: "env-image-key-2222",
    IMAGE_BASE_URL: "https://env-image.example.test",
    IMAGE_MODEL: "env-image-model",
    IMAGE2_BASE_URL: "https://env-extra.example.test",
    IMAGE2_API_KEY: "env-extra-key-3333",
    IMAGE2_MODEL: "grok-image"
  };

  it("masks env-sourced providers and labels their source", () => {
    const masked = toMaskedProviderSettings(null, fullEnv);
    expect(masked.llm).toMatchObject({
      baseUrl: "https://env-llm.example.test",
      apiKey: "••••1111",
      source: "env"
    });
    expect(masked.image).toMatchObject({ apiKey: "••••2222", source: "env" });
    expect(masked.extraImageSites).toHaveLength(1);
    expect(masked.extraImageSites[0]).toMatchObject({ apiKey: "••••3333", source: "env" });
  });

  it("prefers panel overrides and labels them as panel-sourced", () => {
    const masked = toMaskedProviderSettings(
      { llm: llmSettings, image: imageSettings, extraImageSites: [imageSettings] },
      fullEnv
    );
    expect(masked.llm).toMatchObject({
      baseUrl: "https://llm.example.test",
      apiKey: "••••5678",
      source: "panel",
      reviewModel: "glm-5.3-flash"
    });
    expect(masked.image).toMatchObject({ baseUrl: "https://image.example.test", source: "panel" });
    expect(masked.extraImageSites[0]).toMatchObject({ source: "panel" });
  });

  it("reports none for providers configured nowhere", () => {
    const masked = toMaskedProviderSettings(null, {});
    expect(masked.llm).toBeNull();
    expect(masked.image).toBeNull();
    expect(masked.extraImageSites).toEqual([]);
  });

  it("never leaks a full api key", () => {
    const masked = toMaskedProviderSettings({ llm: llmSettings }, fullEnv);
    expect(JSON.stringify(masked)).not.toContain("llm-secret-12345678");
  });
});

describe("parseProviderOverrideJson", () => {
  it("parses valid override objects", () => {
    expect(parseProviderOverrideJson('{"llm":null}')).toEqual({ llm: null });
  });

  it("returns null for broken or non-object payloads", () => {
    expect(parseProviderOverrideJson("not-json")).toBeNull();
    expect(parseProviderOverrideJson("[1,2]")).toBeNull();
    expect(parseProviderOverrideJson("null")).toBeNull();
  });
});
