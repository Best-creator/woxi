// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LlmProviderConfig } from "@/server/config";
import { LlmError } from "./errors";
import { OpenAiJsonClient, type JsonCompletionRequest } from "./openai-json-client";

const config: LlmProviderConfig = {
  baseUrl: "https://llm.example.test/api",
  apiKey: "super-secret-key",
  model: "default-model",
  availableModels: ["default-model", "alternate-model"],
  researchModel: "",
  reviewModel: "",
  visualModel: "",
  visionModel: ""
};

const schema = z.object({ answer: z.string() });
const request = {
  systemPrompt: "Return a JSON answer.",
  userPayload: { question: "What is 2 + 2?" },
  schema,
  timeoutMs: 1_000
};

function completion(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function fetchResponse(make: () => Response): typeof fetch {
  // Response 体只能读一次：工厂每次给一份新的，供重试场景复用。
  return (async () => make()) as typeof fetch;
}

async function expectClientError(
  fetchFn: typeof fetch,
  code: LlmError["code"],
  requestOverride: Partial<JsonCompletionRequest<{ answer: string }>> = {}
) {
  await expect(new OpenAiJsonClient(config, fetchFn).complete({ ...request, ...requestOverride }))
    .rejects.toMatchObject({ code, name: "LlmError" });
}

describe("OpenAiJsonClient", () => {
  it("sends a non-streaming JSON request and returns schema-validated JSON", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return completion(JSON.stringify({ answer: "4" }));
    }) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({ answer: "4" });
    expect(captured.url).toBe("https://llm.example.test/api/v1/chat/completions");
    expect(captured.init?.method).toBe("POST");
    expect(captured.init?.headers).toMatchObject({ Authorization: "Bearer super-secret-key" });
    expect(JSON.parse(String(captured.init?.body))).toEqual({
      model: "default-model",
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: JSON.stringify(request.userPayload) }
      ]
    });
  });

  it("does not POST to the provider root", async () => {
    let url = "";
    const fetchFn = (async (input: string | URL | Request) => {
      url = String(input);
      return completion(JSON.stringify({ answer: "ok" }));
    }) as typeof fetch;

    await new OpenAiJsonClient(config, fetchFn).complete(request);
    expect(url).not.toBe(config.baseUrl);
    expect(url).toBe(`${config.baseUrl}/v1/chat/completions`);
  });

  it("rejects a model that is not in availableModels before fetching", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({ data: [{ id: "default-model" }, { id: "alternate-model" }] });
    }) as typeof fetch;

    await expectClientError(fetchFn, "model_not_allowed", { model: "unknown-model" });
    expect(urls).toEqual(["https://llm.example.test/api/v1/models"]);
  });

  it("rechecks provider models before sending a newly discovered model", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).endsWith("/v1/models")
        ? Response.json({ data: [{ id: "gemini-3.8-flash" }] })
        : completion(JSON.stringify({ answer: "4" }));
    }) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete({
      ...request,
      model: "gemini-3.8-flash"
    })).resolves.toEqual({ answer: "4" });
    expect(urls).toEqual([
      "https://llm.example.test/api/v1/models",
      "https://llm.example.test/api/v1/chat/completions"
    ]);
  });

  it.each([401, 403])("maps HTTP %i to authentication", async (status) => {
    await expectClientError(
      fetchResponse(() => new Response("unauthorized", { status })),
      "authentication"
    );
  });

  it("maps a non-JSON upstream response to invalid_response", async () => {
    await expectClientError(
      fetchResponse(
        () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } })
      ),
      "invalid_response"
    );
  });

  it("maps a response that does not match the schema to invalid_response with the first issue", async () => {
    const error = (await new OpenAiJsonClient(
      config,
      fetchResponse(() => completion(JSON.stringify({ answer: 42 })))
    )
      .complete(request)
      .catch((reason: LlmError) => reason)) as LlmError;

    expect(error).toMatchObject({ code: "invalid_response", name: "LlmError" });
    // 具体坏在哪要透出到报错里——「answer：…」指到字段，排查不用猜。
    expect(error.message).toContain("answer");
    expect(error.message).not.toContain(config.apiKey);
  });

  it("retries once with a corrective note when the model text is not valid JSON", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return completion(bodies.length === 1 ? "这不是JSON" : JSON.stringify({ answer: "4" }));
    }) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({
      answer: "4"
    });
    expect(bodies).toHaveLength(2);
    const retryMessages = JSON.parse(bodies[1]!).messages as Array<{ role: string; content: string }>;
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[2]).toMatchObject({ role: "user" });
    expect(retryMessages[2]!.content).toContain("不是合法 JSON");
  });

  it("retries once when the upstream body itself is not JSON", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("gateway blip", { status: 200, headers: { "content-type": "text/plain" } })
        : completion(JSON.stringify({ answer: "4" }));
    }) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({
      answer: "4"
    });
    expect(calls).toBe(2);
  });

  it("recovers without a retry when the content is wrapped in Markdown code fences", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return completion("```json\n" + JSON.stringify({ answer: "4" }) + "\n```");
    }) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({
      answer: "4"
    });
    expect(calls).toBe(1);
  });

  it("salvages a JSON object baked into prose without consuming the retry", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return completion('好的，这是你要的结果：\n{"answer": "4"}\n请查收。');
    }) as typeof fetch;

    // 散文包裹是最常见的「文本不是合法 JSON」来源——掐头去尾抠出 {} 直接救回，
    // 省掉一整轮纠错重试（抠出来的仍要过 Zod，安全）。
    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({
      answer: "4"
    });
    expect(calls).toBe(1);
  });

  it("joins multi-part content arrays that some gateways return", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: '{"answer":' },
                  { type: "text", text: '"4"}' }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    await expect(new OpenAiJsonClient(config, fetchFn).complete(request)).resolves.toEqual({
      answer: "4"
    });
  });

  it("names truncation in the error when finish_reason is length", async () => {
    const error = (await new OpenAiJsonClient(
      config,
      fetchResponse(() =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: '{"answer": "4' } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )
      .complete(request)
      .catch((reason: LlmError) => reason)) as LlmError;

    // 被长度上限掐断的 JSON 缺尾巴，抢救救不回来——但报错要直说原因，别让用户猜。
    expect(error).toMatchObject({ code: "invalid_response", name: "LlmError" });
    expect(error.message).toContain("截断");
  });

  it("does not retry HTTP status errors", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("gateway failure", { status: 502 });
    }) as typeof fetch;

    await expectClientError(fetchFn, "upstream");
    expect(calls).toBe(1);
  });

  it("maps AbortError fetch failures to timeout and passes an abort signal", async () => {
    let signal: AbortSignal | undefined;
    const failure = new Error("cancelled");
    failure.name = "AbortError";
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      throw failure;
    }) as typeof fetch;

    await expectClientError(fetchFn, "timeout");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("does not expose the API key in errors", async () => {
    let error: LlmError | undefined;
    try {
      await new OpenAiJsonClient(
        config,
        fetchResponse(() => new Response("gateway failure", { status: 502 }))
      ).complete(request);
    } catch (reason) {
      error = reason as LlmError;
    }

    expect(error).toMatchObject({ code: "upstream" });
    expect(error?.message).not.toContain(config.apiKey);
  });
});
