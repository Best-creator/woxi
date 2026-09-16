// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/server/config";
import { OpenAiVisualPlanner, VisualPlannerError } from "./openai-visual-planner";

const config: ProviderConfig = {
  baseUrl: "https://llm.example.test/api",
  apiKey: "super-secret-key",
  model: "test-model"
};

const input = {
  title: "机会成本",
  topic: "机会成本",
  blocks: [
    {
      id: "anchor-1",
      type: "paragraph" as const,
      content: "首先比较两个方案。",
      order: 0,
      version: 1
    },
    {
      id: "existing-image",
      type: "image" as const,
      content: "/api/image-assets/existing/content",
      order: 1,
      version: 1
    }
  ]
};

const validPlan = {
  images: [
    {
      type: "cover",
      anchorBlockId: null,
      purpose: "概览机会成本",
      prompt: "机会成本的清晰中文信息图，无水印，适合公众号阅读",
      altText: "机会成本封面图",
      aspectRatio: "cover"
    },
    {
      type: "process",
      anchorBlockId: "anchor-1",
      purpose: "解释决策过程",
      prompt: "决策步骤的清晰中文信息图，无水印，适合公众号阅读",
      altText: "机会成本决策过程图",
      aspectRatio: "landscape"
    }
  ]
};

function completion(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function fetchResponse(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

async function expectPlannerError(fetchFn: typeof fetch, code: VisualPlannerError["code"]) {
  await expect(new OpenAiVisualPlanner(config, fetchFn).plan(input)).rejects.toMatchObject({ code });
}

describe("OpenAiVisualPlanner", () => {
  it("sends a non-streaming JSON request and returns a schema-validated plan", async () => {
    let request: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return completion(JSON.stringify(validPlan));
    }) as typeof fetch;

    const result = await new OpenAiVisualPlanner(config, fetchFn).plan(input);

    expect(result).toEqual(validPlan.images);
    expect(request.url).toBe("https://llm.example.test/api/v1/chat/completions");
    expect(request.init?.headers).toMatchObject({ Authorization: "Bearer super-secret-key" });
    expect(JSON.parse(String(request.init?.body))).toMatchObject({
      model: "test-model",
      stream: false,
      response_format: { type: "json_object" }
    });
  });

  it("normalizes storyboard frames: scene number and shot fold into purpose and prompt", async () => {
    const storyboardPlan = {
      images: [
        {
          type: "storyboard",
          anchorBlockId: "anchor-1",
          sceneNumber: 2,
          shot: "特写",
          purpose: "解释机会成本的取舍",
          prompt: "角色犹豫地看向两个选项，特写表情",
          altText: "机会成本取舍分镜",
          aspectRatio: "portrait"
        }
      ]
    };
    const fetchFn = fetchResponse(completion(JSON.stringify(storyboardPlan)));

    const result = await new OpenAiVisualPlanner(config, fetchFn).plan(input);

    expect(result).toHaveLength(1);
    // 存储层形状：无 sceneNumber/shot 字段，序号与景别编进 purpose/prompt。
    expect(result[0]).toEqual({
      type: "storyboard",
      anchorBlockId: "anchor-1",
      purpose: "分镜 2｜特写：解释机会成本的取舍",
      prompt: "动漫分镜 第 2 格，特写镜头。角色犹豫地看向两个选项，特写表情",
      altText: "机会成本取舍分镜",
      aspectRatio: "portrait"
    });
  });

  it("raises a controlled upstream error for a non-success response without exposing the key", async () => {
    const error = await new OpenAiVisualPlanner(
      config,
      fetchResponse(new Response("gateway failure", { status: 502 }))
    )
      .plan(input)
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "upstream", name: "VisualPlannerError" });
    expect((error as Error).message).not.toContain(config.apiKey);
  });

  it("maps an authentication response to a controlled error without exposing the key", async () => {
    const error = await new OpenAiVisualPlanner(
      config,
      fetchResponse(new Response("unauthorized", { status: 401 }))
    )
      .plan(input)
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "authentication", name: "VisualPlannerError" });
    expect((error as Error).message).not.toContain(config.apiKey);
  });

  it.each([401, 403])("maps HTTP %i to an authentication error", async (status) => {
    await expectPlannerError(
      fetchResponse(new Response("forbidden", { status })),
      "authentication"
    );
  });

  it.each(["AbortError", "TimeoutError"])(
    "maps a %s fetch failure to a timeout error and sends an abort signal",
    async (name) => {
      let signal: AbortSignal | undefined;
      const failure = new Error("request cancelled");
      failure.name = name;
      const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal as AbortSignal | undefined;
        throw failure;
      }) as typeof fetch;

      await expect(new OpenAiVisualPlanner(config, fetchFn).plan(input)).rejects.toMatchObject({
        code: "timeout",
        name: "VisualPlannerError"
      });
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  );

  it("rejects an empty completion response", async () => {
    await expectPlannerError(fetchResponse(completion(JSON.stringify({ choices: [] }))), "invalid_response");
  });

  it("rejects non-JSON completion content", async () => {
    await expectPlannerError(fetchResponse(completion("not-json")), "invalid_response");
  });

  it("rejects a completion plan with more than twelve images", async () => {
    const oversized = {
      images: Array.from({ length: 13 }, (_, index) => ({
        ...validPlan.images[1],
        purpose: `图${index + 1}`,
        prompt: `提示词${index + 1}`,
        altText: `替代文本${index + 1}`
      }))
    };

    await expectPlannerError(fetchResponse(completion(JSON.stringify(oversized))), "invalid_response");
  });

  it("rejects an image anchor that does not belong to a non-image input block", async () => {
    const invalidAnchor = {
      images: [{ ...validPlan.images[1], anchorBlockId: "existing-image" }]
    };

    await expectPlannerError(fetchResponse(completion(JSON.stringify(invalidAnchor))), "invalid_response");
  });

  it("injects drawing style and reference character guidance into the system prompt", async () => {
    let request: { init?: RequestInit } = {};
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = { init };
      return completion(JSON.stringify(validPlan));
    }) as typeof fetch;

    await new OpenAiVisualPlanner(config, fetchFn).plan({
      ...input,
      style: "简笔画",
      character: {
        name: "蘑菇老师",
        persona: "自媒体科普老师",
        description: "红伞白点的卡通蘑菇，戴圆框眼镜"
      }
    });

    const body = JSON.parse(String(request.init?.body)) as {
      messages: Array<{ role: string; content: string | Array<unknown> }>;
    };
    const system = body.messages.find((message) => message.role === "system")?.content as string;

    expect(system).toContain("简笔画");
    expect(system).toContain("蘑菇老师");
    expect(system).toContain("自媒体科普老师");
    expect(system).toContain("红伞白点的卡通蘑菇，戴圆框眼镜");
    expect(system).toContain("画面文字");
    // 底色规则恒定生效：拼长图要靠每格白底连成一张纸，不能随风格漂走。
    expect(system).toContain("#FFFFFF");
    // 用户消息中同步携带风格与形象，且不把整个 input 原样透传。
    const userPayload = JSON.parse(body.messages.find((message) => message.role === "user")?.content as string) as Record<string, unknown>;
    expect(userPayload).toMatchObject({
      style: "简笔画",
      character: { name: "蘑菇老师" },
      title: "机会成本"
    });
  });

  it("keeps the base prompt when no style or character is provided", async () => {
    let request: { init?: RequestInit } = {};
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = { init };
      return completion(JSON.stringify(validPlan));
    }) as typeof fetch;

    await new OpenAiVisualPlanner(config, fetchFn).plan(input);

    const system = (JSON.parse(String(request.init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    }).messages[0].content;
    expect(system).not.toContain("绘制风格：");
    expect(system).not.toContain("参考形象：");
    expect(system).toContain("画面文字");
    expect(system).toContain("#FFFFFF");
  });
});
