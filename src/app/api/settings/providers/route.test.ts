// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import {
  createProvidersRouteHandler,
  type ProvidersRouteDeps
} from "./route";
import type { ProviderOverrideValue } from "@/features/settings/provider-settings";

const ENV = {
  LLM_API_KEY: "env-llm-key-9999",
  LLM_MODEL: "env-model",
  IMAGE_API_KEY: "env-image-key-8888",
  IMAGE_MODEL: "env-image-model"
};

function createMemoryDeps(initial: ProviderOverrideValue | null = null) {
  const state: {
    row: { value: ProviderOverrideValue | null; updatedAt: string | null };
    configChangedCalls: number;
  } = {
    row: initial
      ? { value: initial, updatedAt: "2026-09-17T00:00:00.000Z" }
      : { value: null, updatedAt: null },
    configChangedCalls: 0
  };
  const deps: ProvidersRouteDeps = {
    loadRow: () => state.row,
    saveRow: (value) => {
      const updatedAt = new Date().toISOString();
      state.row = { value, updatedAt };
      return updatedAt;
    },
    getEnv: () => ENV,
    onConfigChanged: () => {
      state.configChangedCalls += 1;
    }
  };
  return { deps, state };
}

const fullLlm = {
  baseUrl: "https://llm.example.test",
  apiKey: "brand-new-key",
  model: "grok-4.6",
  models: "",
  researchModel: "",
  reviewModel: "",
  visualModel: "",
  visionModel: ""
};

function putRequest(body: unknown) {
  return new Request("http://localhost/api/settings/providers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("providers route", () => {
  describe("GET", () => {
    it("returns masked env-sourced settings when no override row exists", async () => {
      const { deps } = createMemoryDeps();
      const response = await createProvidersRouteHandler(deps).GET();
      const payload = await response.json();

      expect(payload.updatedAt).toBeNull();
      expect(payload.settings.llm).toMatchObject({ apiKey: "••••9999", source: "env" });
      expect(payload.settings.image).toMatchObject({ apiKey: "••••8888", source: "env" });
      expect(JSON.stringify(payload)).not.toContain("env-llm-key-9999");
    });

    it("labels panel-sourced settings and hides their secrets", async () => {
      const { deps } = createMemoryDeps({ llm: fullLlm });
      const response = await createProvidersRouteHandler(deps).GET();
      const payload = await response.json();

      expect(payload.settings.llm).toMatchObject({
        baseUrl: "https://llm.example.test",
        apiKey: "••••-key",
        source: "panel"
      });
      expect(JSON.stringify(payload)).not.toContain("brand-new-key");
    });
  });

  describe("PUT", () => {
    let deps: ProvidersRouteDeps;
    let state: ReturnType<typeof createMemoryDeps>["state"];

    beforeEach(() => {
      const memory = createMemoryDeps();
      deps = memory.deps;
      state = memory.state;
    });

    it("stores settings, fires the hot-reload hook and returns the new masked view", async () => {
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({ llm: fullLlm, expectedUpdatedAt: "" })
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(state.configChangedCalls).toBe(1);
      expect(state.row.value).toMatchObject({ llm: { apiKey: "brand-new-key" } });
      expect(payload.settings.llm).toMatchObject({ source: "panel", apiKey: "••••-key" });
      expect(typeof payload.updatedAt).toBe("string");
    });

    it("resolves masked api keys against the env truth without persisting the mask", async () => {
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({
          llm: { ...fullLlm, apiKey: "••••9999" },
          expectedUpdatedAt: ""
        })
      );
      expect(response.status).toBe(200);
      expect(state.row.value?.llm?.apiKey).toBe("env-llm-key-9999");
    });

    it("rejects masked keys when no stored truth exists anywhere", async () => {
      const memory = createMemoryDeps();
      memory.state.row = { value: null, updatedAt: null };
      const bareDeps: ProvidersRouteDeps = {
        ...memory.deps,
        getEnv: () => ({ LLM_API_KEY: "env-llm-key-9999" }) // IMAGE_API_KEY 缺失
      };
      const response = await createProvidersRouteHandler(bareDeps).PUT(
        putRequest({
          image: { baseUrl: "https://image.example.test", apiKey: "••••0000", model: "m" },
          expectedUpdatedAt: ""
        })
      );
      expect(response.status).toBe(400);
      expect(memory.state.configChangedCalls).toBe(0);
    });

    it("resolves masked extra-site keys against the env site with the same baseUrl", async () => {
      // 回归：env 来源的额外站点（IMAGE2_*）首次保存时覆盖行里没有存量真值，
      // 必须按 baseUrl 精确回落到 env，而不是报「找不到已保存的真值」。
      const memory = createMemoryDeps();
      memory.state.row = { value: null, updatedAt: null };
      const envDeps: ProvidersRouteDeps = {
        ...memory.deps,
        getEnv: () => ({
          ...ENV,
          IMAGE2_BASE_URL: "https://env-extra.example.test",
          IMAGE2_API_KEY: "env-extra-truth",
          IMAGE2_MODEL: "grok-image"
        })
      };
      const response = await createProvidersRouteHandler(envDeps).PUT(
        putRequest({
          extraImageSites: [{ baseUrl: "https://env-extra.example.test", apiKey: "••••truth", model: "grok-image" }],
          expectedUpdatedAt: ""
        })
      );
      expect(response.status).toBe(200);
      expect(memory.state.row.value?.extraImageSites?.[0]?.apiKey).toBe("env-extra-truth");
    });

    it("returns 409 when the row changed underneath the client", async () => {
      state.row = { value: null, updatedAt: "2026-09-17T01:00:00.000Z" };
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({ llm: fullLlm, expectedUpdatedAt: "" })
      );
      expect(response.status).toBe(409);
      expect(state.row.updatedAt).toBe("2026-09-17T01:00:00.000Z");
    });

    it("drops the override row entirely when every family resets to null", async () => {
      state.row = { value: { llm: fullLlm }, updatedAt: "2026-09-17T00:00:00.000Z" };
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({ llm: null, expectedUpdatedAt: "2026-09-17T00:00:00.000Z" })
      );
      expect(response.status).toBe(200);
      // 覆盖行里只剩 llm 且被清空 → 整行删除，全部回落 env。
      expect(state.row.value).toBeNull();
      const payload = await response.json();
      expect(payload.settings.llm.source).toBe("env");
    });

    it("keeps the override row when other families remain configured", async () => {
      state.row = {
        value: { llm: fullLlm, image: { baseUrl: "https://image.example.test", apiKey: "img-key", model: "m" } },
        updatedAt: "2026-09-17T00:00:00.000Z"
      };
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({ llm: null, expectedUpdatedAt: "2026-09-17T00:00:00.000Z" })
      );
      expect(response.status).toBe(200);
      expect(state.row.value).toMatchObject({ image: { apiKey: "img-key" } });
      const payload = await response.json();
      expect(payload.settings.llm.source).toBe("env");
      expect(payload.settings.image.source).toBe("panel");
    });

    it("returns 400 for invalid payloads", async () => {
      const response = await createProvidersRouteHandler(deps).PUT(
        putRequest({ llm: { baseUrl: "not-a-url" }, expectedUpdatedAt: "" })
      );
      expect(response.status).toBe(400);
    });
  });
});
