import { describe, expect, it, vi } from "vitest";
import { parseServerConfig } from "./config";
import { discoverLlmModels, pickPreferredModel } from "./llm-models";

const config = {
  baseUrl: "https://llm.example.test",
  apiKey: "secret",
  model: "grok-4.6",
  availableModels: ["grok-4.6"]
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
    await expect(discoverLlmModels(config, fetchFn)).rejects.toMatchObject({ code: "upstream" });
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
});
