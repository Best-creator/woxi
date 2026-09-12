// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const configState = vi.hoisted(() => ({
  llm: null as { baseUrl: string; apiKey: string; model: string; availableModels: string[] } | null
}));

vi.mock("./config", () => ({
  getServerConfig: () => ({
    databasePath: ":memory:",
    llm: configState.llm,
    image: { baseUrl: "https://image.example.test", apiKey: "unused", model: "unused" }
  })
}));

describe("getVisualPlanner", () => {
  beforeEach(() => {
    configState.llm = null;
    vi.resetModules();
  });

  it("uses the deterministic planner when no LLM provider is configured", async () => {
    const [{ getVisualPlanner }, { DemoVisualPlanner }] = await Promise.all([
      import("./services"),
      import("@/features/images/demo-visual-planner")
    ]);

    expect(getVisualPlanner()).toBeInstanceOf(DemoVisualPlanner);
  });

  it("uses the OpenAI-compatible planner when an LLM provider is configured", async () => {
    configState.llm = {
      baseUrl: "https://llm.example.test",
      apiKey: "configured-key",
      model: "configured-model",
      availableModels: ["configured-model"]
    };
    const [{ getVisualPlanner }, { OpenAiVisualPlanner }] = await Promise.all([
      import("./services"),
      import("@/features/images/openai-visual-planner")
    ]);

    expect(getVisualPlanner()).toBeInstanceOf(OpenAiVisualPlanner);
  });
});

describe("content agents", () => {
  beforeEach(() => {
    configState.llm = null;
    vi.resetModules();
  });

  it("uses deterministic content agents when no LLM provider is configured", async () => {
    const [
      { getContentGenerator, getContentReviewer },
      { DemoContentGenerator, DemoContentReviewer }
    ] = await Promise.all([
      import("./services"),
      import("@/features/content/demo-content-agents")
    ]);

    expect(getContentGenerator()).toBeInstanceOf(DemoContentGenerator);
    expect(getContentReviewer()).toBeInstanceOf(DemoContentReviewer);
  });

  it("uses OpenAI content agents sharing one JSON client when an LLM provider is configured", async () => {
    configState.llm = {
      baseUrl: "https://llm.example.test",
      apiKey: "configured-key",
      model: "configured-model",
      availableModels: ["configured-model"]
    };
    const [
      { getContentGenerator, getContentReviewer },
      { OpenAiContentGenerator },
      { OpenAiContentReviewer }
    ] = await Promise.all([
      import("./services"),
      import("@/features/content/openai-content-generator"),
      import("@/features/content/openai-content-reviewer")
    ]);

    const generator = getContentGenerator();
    const reviewer = getContentReviewer();

    expect(generator).toBeInstanceOf(OpenAiContentGenerator);
    expect(reviewer).toBeInstanceOf(OpenAiContentReviewer);
    expect((generator as unknown as { client: unknown }).client).toBe(
      (reviewer as unknown as { client: unknown }).client
    );
  });
});

describe("outline agents", () => {
  beforeEach(() => {
    configState.llm = null;
    vi.resetModules();
  });

  it("uses deterministic outline agents when no LLM provider is configured", async () => {
    const [
      { getOutlineGenerator, getOutlineReviewer },
      { DemoOutlineGenerator, DemoOutlineReviewer }
    ] = await Promise.all([
      import("./services"),
      import("@/features/outlines/demo-outline-agents")
    ]);

    expect(getOutlineGenerator()).toBeInstanceOf(DemoOutlineGenerator);
    expect(getOutlineReviewer()).toBeInstanceOf(DemoOutlineReviewer);
  });

  it("uses OpenAI outline agents with one shared JSON client when an LLM provider is configured", async () => {
    configState.llm = {
      baseUrl: "https://llm.example.test",
      apiKey: "configured-key",
      model: "configured-model",
      availableModels: ["configured-model"]
    };
    const [
      { getOutlineGenerator, getOutlineReviewer },
      { OpenAiOutlineGenerator },
      { OpenAiOutlineReviewer }
    ] = await Promise.all([
      import("./services"),
      import("@/features/outlines/openai-outline-generator"),
      import("@/features/outlines/openai-outline-reviewer")
    ]);

    const generator = getOutlineGenerator();
    const reviewer = getOutlineReviewer();

    expect(generator).toBeInstanceOf(OpenAiOutlineGenerator);
    expect(reviewer).toBeInstanceOf(OpenAiOutlineReviewer);
    expect((generator as unknown as { client: unknown }).client).toBe(
      (reviewer as unknown as { client: unknown }).client
    );
  });
});
