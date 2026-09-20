// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ImageGeneratorError, sizeForAspectRatio } from "./image-generator";
import { OpenAiImageGenerator } from "./openai-image-generator";
import type { ImageSite } from "./image-catalog";

const site: ImageSite = {
  baseUrl: "https://image.example.test/api",
  apiKey: "super-secret-key",
  model: "test-image-model",
  name: "image"
};

const backupSite: ImageSite = {
  baseUrl: "https://mirror.example.test",
  apiKey: "mirror-key",
  model: "mirror-image-model",
  name: "mirror"
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
    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return generationResponse({
        url: "https://cdn.example.test/images/a.png",
        b64_json: SAMPLE_PNG.toString("base64"),
        output_format: "png"
      });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

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
      [site],
      fetchRespondingWith(generationResponse({ url: "https://cdn.example.test/images/a.png" })) as typeof fetch
    );
    const payload = await generator.generate({ prompt: "一张图", aspectRatio: "square" });
    expect(payload.remoteUrl).toBe("https://cdn.example.test/images/a.png");
    expect(payload.binary).toBeNull();
    expect(payload.format).toBe("png");
  });

  it("accepts a binary-only response", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(generationResponse({ b64_json: SAMPLE_PNG.toString("base64") })) as typeof fetch
    );
    const payload = await generator.generate({ prompt: "一张图", aspectRatio: "square" });
    expect(payload.remoteUrl).toBeNull();
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
  });

  it("rejects an empty item", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(generationResponse({})) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      name: "ImageGeneratorError",
      code: "invalid_response"
    });
  });

  it("maps authentication failures", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(new Response("denied", { status: 401 })) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "authentication"
    });
  });

  it("surfaces the upstream error body instead of a generic message", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(
        new Response(JSON.stringify({ error: { message: "insufficient_quota: 请充值" } }), {
          status: 500
        })
      ) as typeof fetch
    );
    const error = (await generator
      .generate({ prompt: "x", aspectRatio: "square" })
      .catch((caught: unknown) => caught)) as ImageGeneratorError;
    expect(error.code).toBe("upstream");
    expect(error.message).toContain("insufficient_quota: 请充值");
  });

  it("classifies an upstream content policy block so callers can retry with fewer instructions", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(
        new Response(
          JSON.stringify({
            error: { code: "upstream_content_blocked", message: "M365 content policy blocked this request" }
          }),
          { status: 502 }
        )
      ) as typeof fetch
    );

    const error = (await generator
      .generate({ prompt: "x", aspectRatio: "square" })
      .catch((caught: unknown) => caught)) as ImageGeneratorError;

    expect(error.code).toBe("content_blocked");
    // 不是限流：没有被上游要求冷却，外层不该为它等 429 的重试节奏。
    expect(error.cooldownSeconds).toBeNull();
    expect(error.message).toContain("内容策略拦截");
  });

  it("recognises a content block that only shows up in the message text", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(
        new Response(JSON.stringify({ error: { message: "request rejected by content filter" } }), {
          status: 400
        })
      ) as typeof fetch
    );

    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "content_blocked"
    });
  });

  it("routes input.model to its owning site via the catalog", async () => {
    const calledUrls: string[] = [];
    const fetchFn = async (url: unknown) => {
      calledUrls.push(String(url));
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    // mirror 站默认模型是 mirror-image-model；请求 mirror-image-model 时应打向 mirror 站。
    const generator = new OpenAiImageGenerator(
      [site, backupSite],
      fetchFn as typeof fetch,
      async () => [
        { id: "test-image-model", provider: "image" },
        { id: "mirror-image-model", provider: "mirror" }
      ]
    );

    await generator.generate({ prompt: "x", aspectRatio: "square", model: "mirror-image-model" });

    expect(calledUrls[0]).toBe("https://mirror.example.test/v1/images/generations");
  });

  it("falls back to the main site when the model is unknown to the catalog", async () => {
    const calledUrls: string[] = [];
    const fetchFn = async (url: unknown) => {
      calledUrls.push(String(url));
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    const generator = new OpenAiImageGenerator(
      [site, backupSite],
      fetchFn as typeof fetch,
      async () => [{ id: "test-image-model", provider: "image" }]
    );

    await generator.generate({ prompt: "x", aspectRatio: "square", model: "brand-new-model" });

    expect(calledUrls[0]).toBe("https://image.example.test/api/v1/images/generations");
  });

  it("retries after a 429 cooldown when reset_seconds is present", async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({ error: { message: '当前分组负载已饱和，"reset_seconds": 0' } }),
          { status: 429 }
        );
      }
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    const payload = await generator.generate({ prompt: "x", aspectRatio: "square" });
    expect(attempts).toBe(2);
    expect(payload.binary).not.toBeNull();
  });

  it("gives up after the third cooldown attempt", async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      return new Response(
        JSON.stringify({ error: { message: '冷却中，"reset_seconds": 0' } }),
        { status: 429 }
      );
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "upstream"
    });
    expect(attempts).toBe(3);
  });

  it("maps timeouts", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const generator = new OpenAiImageGenerator(
      [site],
      fetchRespondingWith(timeoutError) as typeof fetch
    );
    await expect(generator.generate({ prompt: "x", aspectRatio: "square" })).rejects.toMatchObject({
      code: "timeout"
    });
  });

  it("maps malformed JSON bodies", async () => {
    const generator = new OpenAiImageGenerator(
      [site],
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

  it("posts reference images to the edits endpoint as multipart files", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchFn = async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    const payload = await generator.generate({
      prompt: "画蘑菇老师讲课",
      aspectRatio: "portrait",
      referenceImages: [{ data: SAMPLE_PNG, mimeType: "image/png" }]
    });

    expect(capturedUrl).toBe("https://image.example.test/api/v1/images/edits");
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    const formData = capturedInit?.body as FormData;
    expect(formData.get("model")).toBe("test-image-model");
    expect(formData.get("prompt")).toBe("画蘑菇老师讲课");
    expect(formData.get("size")).toBe("1024x1536");
    expect(formData.get("response_format")).toBe("b64_json");
    const file = formData.get("image");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("image/png");
    expect(Buffer.from(await (file as Blob).arrayBuffer()).equals(SAMPLE_PNG)).toBe(true);
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
  });

  it("falls back to generations with data-url references when the edits endpoint fails", async () => {
    const calledUrls: string[] = [];
    let capturedBody: unknown;
    const fetchFn = async (url: unknown, init?: RequestInit) => {
      calledUrls.push(String(url));
      if (calledUrls.length === 1) {
        return new Response("edits channel unavailable", { status: 503 });
      }
      capturedBody = JSON.parse(String(init?.body));
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    const payload = await generator.generate({
      prompt: "x",
      aspectRatio: "square",
      referenceImages: [{ data: SAMPLE_PNG, mimeType: "image/png" }]
    });

    expect(calledUrls).toEqual([
      "https://image.example.test/api/v1/images/edits",
      "https://image.example.test/api/v1/images/generations"
    ]);
    expect(capturedBody).toMatchObject({
      model: "test-image-model",
      prompt: "x",
      size: "1024x1024",
      image: [`data:image/png;base64,${SAMPLE_PNG.toString("base64")}`]
    });
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
  });

  it("does not fall back when the edits endpoint rejects the credentials", async () => {
    const calledUrls: string[] = [];
    const fetchFn = async (url: unknown) => {
      calledUrls.push(String(url));
      return new Response("denied", { status: 401 });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    await expect(
      generator.generate({
        prompt: "x",
        aspectRatio: "square",
        referenceImages: [{ data: SAMPLE_PNG, mimeType: "image/png" }]
      })
    ).rejects.toMatchObject({ code: "authentication" });
    expect(calledUrls).toEqual(["https://image.example.test/api/v1/images/edits"]);
  });

  it("does not fall back on cooldown so the outer retry loop reruns the edits path", async () => {
    let attempts = 0;
    const calledUrls: string[] = [];
    const fetchFn = async (url: unknown) => {
      attempts++;
      calledUrls.push(String(url));
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: '冷却中，"reset_seconds": 0' } }), {
          status: 429
        });
      }
      return generationResponse({ b64_json: SAMPLE_PNG.toString("base64") });
    };
    const generator = new OpenAiImageGenerator([site], fetchFn as typeof fetch);

    const payload = await generator.generate({
      prompt: "x",
      aspectRatio: "square",
      referenceImages: [{ data: SAMPLE_PNG, mimeType: "image/png" }]
    });

    expect(calledUrls).toEqual([
      "https://image.example.test/api/v1/images/edits",
      "https://image.example.test/api/v1/images/edits"
    ]);
    expect(payload.binary?.equals(SAMPLE_PNG)).toBe(true);
  });
});
