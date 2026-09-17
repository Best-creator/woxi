// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderSettingsPanel } from "./provider-settings-panel";
import type { MaskedProviderSettings } from "@/features/settings/provider-settings";

const envSettings: MaskedProviderSettings = {
  llm: {
    baseUrl: "https://env-llm.example.test",
    apiKey: "••••1111",
    model: "env-model",
    models: "env-a, env-b",
    researchModel: "env-research",
    reviewModel: "",
    visualModel: "",
    visionModel: "",
    source: "env"
  },
  image: {
    baseUrl: "https://env-image.example.test",
    apiKey: "••••2222",
    model: "env-image-model",
    source: "env"
  },
  extraImageSites: []
};

const noneSettings: MaskedProviderSettings = {
  llm: null,
  image: null,
  extraImageSites: []
};

interface FetchPlan {
  status: number;
  payload: unknown;
}

function createFetchStub(plan: (url: string, init: RequestInit | undefined) => FetchPlan) {
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = plan(String(input), init);
    return {
      ok: route.status < 400,
      status: route.status,
      json: async () => route.payload
    } as unknown as Response;
  });
  return stub;
}

function lastBody(stub: ReturnType<typeof createFetchStub>) {
  const call = stub.mock.calls.at(-1)!;
  return JSON.parse(String(call[1]?.body));
}

describe("ProviderSettingsPanel", () => {
  it("renders masked env-sourced settings with source badges", () => {
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={createFetchStub(() => ({ status: 200, payload: {} }))}
      />
    );

    expect(screen.getByRole("heading", { name: "Provider 设置" })).toBeDefined();
    expect(screen.getAllByText("环境变量").length).toBeGreaterThanOrEqual(2);
    const apiKey = screen.getByLabelText("API Key") as HTMLInputElement;
    expect(apiKey.value).toBe("••••1111");
    expect(JSON.stringify(document.body.textContent)).not.toContain("env-llm-key");
  });

  it("shows the unconfigured badge when no provider is set", () => {
    render(
      <ProviderSettingsPanel
        initialSettings={noneSettings}
        initialUpdatedAt={null}
        fetchImpl={createFetchStub(() => ({ status: 200, payload: {} }))}
      />
    );

    expect(screen.getAllByText("未配置").length).toBe(2);
  });

  it("saves all providers with masked keys and the concurrency base", async () => {
    const fetchStub = createFetchStub(() => ({
      status: 200,
      payload: { updatedAt: "2026-09-17T08:00:00.000Z", settings: envSettings }
    }));
    const onSaved = vi.fn();
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"));

    const body = lastBody(fetchStub);
    expect(body.expectedUpdatedAt).toBe("2026-09-17T07:00:00.000Z");
    expect(body.llm.apiKey).toBe("••••1111");
    expect(body.image.apiKey).toBe("••••2222");
    expect(fetchStub.mock.calls[0][0]).toBe("/api/settings/providers");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("surfaces conflict errors from a 409 response", async () => {
    const fetchStub = createFetchStub(() => ({
      status: 409,
      payload: { error: "配置已被其他窗口修改，请刷新后重试" }
    }));
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已被其他窗口修改"));
  });

  it("tests the LLM connection and reports the discovered models", async () => {
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 200, payload: { ok: true, models: ["grok-4.6", "glm-5.3-flash"] } };
      return { status: 200, payload: {} };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );

    const llmCard = screen.getByRole("group", { name: "LLM 网关" });
    fireEvent.click(within(llmCard).getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(llmCard.textContent).toContain("连接成功 · 发现 2 个模型"));

    const body = lastBody(fetchStub);
    expect(body).toMatchObject({ scope: "llm", baseUrl: "https://env-llm.example.test", apiKey: "••••1111" });
  });

  it("shows the connection error message on failure", async () => {
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 502, payload: { error: "语言模型服务认证失败" } };
      return { status: 200, payload: {} };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );

    const llmCard = screen.getByRole("group", { name: "LLM 网关" });
    fireEvent.click(within(llmCard).getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(within(llmCard).getByRole("alert").textContent).toContain("认证失败"));
  });

  it("offers the env fallback button only for panel-sourced providers", async () => {
    const panelSettings: MaskedProviderSettings = {
      ...envSettings,
      llm: { ...envSettings.llm!, source: "panel" }
    };
    const fetchStub = createFetchStub(() => ({
      status: 200,
      payload: { updatedAt: "2026-09-17T08:00:00.000Z", settings: panelSettings }
    }));
    render(
      <ProviderSettingsPanel
        initialSettings={panelSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
      />
    );

    expect(screen.getAllByRole("button", { name: "恢复环境变量默认" }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "恢复环境变量默认" }));
    await waitFor(() => expect(fetchStub).toHaveBeenCalled());
    expect(lastBody(fetchStub).llm).toBeNull();
  });

  it("refreshes the source badge from the save response", async () => {
    const savedSettings: MaskedProviderSettings = {
      ...envSettings,
      llm: { ...envSettings.llm!, source: "panel" }
    };
    const fetchStub = createFetchStub(() => ({
      status: 200,
      payload: { updatedAt: "2026-09-17T08:00:00.000Z", settings: savedSettings }
    }));
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
      />
    );

    expect(screen.getAllByText("环境变量").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(screen.getByText("面板配置")).toBeDefined());
    // 徽章刷新后，「恢复环境变量默认」按钮出现
    expect(screen.getByRole("button", { name: "恢复环境变量默认" })).toBeDefined();
  });

  it("adds and removes extra image site rows", () => {
    render(
      <ProviderSettingsPanel
        initialSettings={noneSettings}
        initialUpdatedAt={null}
        fetchImpl={createFetchStub(() => ({ status: 200, payload: {} }))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /添加站点/ }));
    expect(screen.getByLabelText("站点 1 服务地址")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /添加站点/ }));
    expect(screen.getByLabelText("站点 2 服务地址")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "删除额外生图站点 1" }));
    expect(screen.queryByLabelText("站点 2 服务地址")).toBeNull();
    expect(screen.getByLabelText("站点 1 服务地址")).toBeDefined();
  });

  it("edits role models through labelled inputs", () => {
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={createFetchStub(() => ({ status: 200, payload: {} }))}
      />
    );

    const reviewModel = screen.getByLabelText("审核模型") as HTMLInputElement;
    expect(reviewModel.value).toBe("");
    fireEvent.change(reviewModel, { target: { value: "glm-5.3-flash" } });
    expect(reviewModel.value).toBe("glm-5.3-flash");
  });
});
