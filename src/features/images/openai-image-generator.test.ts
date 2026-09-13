// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/server/config";
import { ImageGeneratorError, sizeForAspectRatio } from "./image-generator";
import { OpenAiImageGenerator } from "./openai-image-generator";

const config: ProviderConfig = {
  baseUrl: "https://image.example.test/api",
  apiKey: "super-secret-key",
  model: "test-image-model"
};

const SAMPLE_PNG = Buffer.from("89504e470d0a1a0a", "hex");

function generationResponse(item: unknown, status = 200) {
  return new Response(JSON.stringify({ created: 1, data: [item] }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fetchRespondingWith(response: Response | Error) {
  return async () => (response instanceof Error ? Promise.reject(response) : response);
}

describe("sizeForAspectRatio", () => {
  it("maps the four workspace ratios to upstream-supported sizes", () => {
    expect(sizeForAspectRatio("cover")).toBe("1536x1024");
    expect(sizeForAspectRatio("landscape")).toBe("1536x1024");
    expect(sizeForAspectRatio("square")).toBe("1024x1024");
    expect(sizeForAspectRatio("portrait")).toBe("1024x1536");
  });
});

describe("OpenAiImageGenerator", () => {
  it("posts model, prompt and mapped size, and returns url and binary when both exist", async () => {
    let capturedBody: unknown;
    const fetchFn = async (url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return generationResponse({
        url: "https://cdn.example.test/images/a.png",
        b64_json: SAMPLE_PNG.toString("base64"),
        output_format: "png"
      });
    };
    const generator = new OpenAiImageGenerator(config, fetchFn as typeof fetch);

    const payload = await generator.generate({ prompt: "一张图", aspectRatio: "portrait" });

    expect(capturedBody).toMatchObject({
      model: "test-image-model",
      prompt: "一张图",
      size: "1024x1536",
      n: 1
    });
    expect(payload.remoteUrl).toBe("https://cdn.example.test/images/a.png");
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
    expect(payload.format).toBe("png");
  });

  it("accepts a url-only response", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(generationResponse({ url: "https://cdn.example.test/images/a.png" })) as typeof fetch
    );
    const payload = await generator.generate({ prompt: "一张图", aspectRatio: "square" });
    expect(payload.remoteUrl).toBe("https://cdn.example.test/images/a.png");
    expect(payload.binary).toBeNull();
    expect(payload.format).toBe("png");
  });

  it("accepts a binary-only response", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(generationResponse({ b64_json: SAMPLE_PNG.toString("base64") })) as typeof fetch
    );
    const payload = await generator.generate({ prompt: "一张图", aspectRatio: "square" });
    expect(payload.remoteUrl).toBeNull();
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
  });

  it("rejects an empty item", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(generationResponse({})) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      name: "ImageGeneratorError",
      code: "invalid_response"
    });
  });

  it("maps authentication failures", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(new Response("denied", { status: 401 })) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "authentication"
    });
  });

  it("maps upstream failures", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(new Response("boom", { status: 500 })) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "upstream"
    });
  });

  it("maps timeouts", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(timeoutError) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "timeout"
    });
  });

  it("maps malformed JSON bodies", async () => {
    const generator = new OpenAiImageGenerator(
      config,
      fetchRespondingWith(new Response("not-json", { status: 200 })) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "invalid_response"
    });
  });

  it("keeps ImageGeneratorError name for consumers", () => {
    const error = new ImageGeneratorError("upstream", "服务不可用");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("服务不可用");
  });
});
