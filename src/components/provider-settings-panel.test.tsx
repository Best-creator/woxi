// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderSettingsPanel } from "./provider-settings-panel";
import type { MaskedProviderSettings } from "@/features/settings/provider-settings";

const API_URL = "/api/settings/providers";

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

/** PUT 保存请求体（精确匹配面板根路径，排除 /test）。 */
function putBodies(stub: ReturnType<typeof createFetchStub>) {
  return stub.mock.calls
    .filter(([url]) => String(url) === API_URL)
    .map((call) => JSON.parse(String(call[1]?.body)));
}

/** /test 拉取请求体（按 scope 过滤）。 */
function testBodies(stub: ReturnType<typeof createFetchStub>, scope?: "llm" | "image") {
  return stub.mock.calls
    .filter(([url]) => String(url).endsWith("/test"))
    .map((call) => JSON.parse(String(call[1]?.body)))
    .filter((body) => !scope || body.scope === scope);
}

function selectOptions(element: HTMLSelectElement | HTMLInputElement) {
  if (!(element instanceof HTMLSelectElement)) return null;
  return Array.from(element.options).map((option) => option.value);
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

    const bodies = putBodies(fetchStub);
    expect(bodies.length).toBe(1);
    expect(bodies[0].expectedUpdatedAt).toBe("2026-09-17T07:00:00.000Z");
    expect(bodies[0].llm.apiKey).toBe("••••1111");
    expect(bodies[0].image.apiKey).toBe("••••2222");
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

  it("auto-pulls model lists on mount and renders selects with discovered options", async () => {
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

    // 挂载即自动拉取：等发现的模型真正进入下拉选项（而非仅 fetch 已调用）
    await waitFor(() => {
      const modelSelect = screen.getByLabelText("默认模型") as HTMLSelectElement;
      expect(selectOptions(modelSelect)).toContain("grok-4.6");
    });
    await waitFor(() => {
      const imageSelect = screen.getByLabelText("生成模型") as HTMLSelectElement;
      expect(selectOptions(imageSelect)).toContain("grok-4.6");
    });

    // 拉取请求：LLM 与生图各一次，掩码 key 原样提交由服务端解析
    expect(testBodies(fetchStub, "llm")[0]).toMatchObject({
      baseUrl: "https://env-llm.example.test",
      apiKey: "••••1111"
    });
    expect(testBodies(fetchStub, "image")[0]).toMatchObject({
      baseUrl: "https://env-image.example.test",
      apiKey: "••••2222"
    });

    // 默认模型变为下拉，发现模型与当前值合并（不丢值）
    const modelSelect = screen.getByLabelText("默认模型") as HTMLSelectElement;
    expect(modelSelect.tagName).toBe("SELECT");
    const values = selectOptions(modelSelect)!;
    expect(values).toContain("grok-4.6");
    expect(values).toContain("glm-5.3-flash");
    expect(values).toContain("env-model");

    // 分工字段带「跟随默认模型」空选项
    const reviewSelect = screen.getByLabelText("审核模型") as HTMLSelectElement;
    expect(reviewSelect.tagName).toBe("SELECT");
    const reviewValues = selectOptions(reviewSelect)!;
    expect(reviewValues[0]).toBe("");
    expect(within(reviewSelect).getByText("跟随默认模型")).toBeDefined();
  });

  it("edits a role model through its labelled select", async () => {
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={createFetchStub(() => ({ status: 200, payload: {} }))}
      />
    );

    const reviewSelect = screen.getByLabelText("审核模型") as HTMLSelectElement;
    expect(reviewSelect.tagName).toBe("SELECT");
    expect(reviewSelect.value).toBe("");
    fireEvent.change(reviewSelect, { target: { value: "env-b" } });
    expect(reviewSelect.value).toBe("env-b");
  });

  it("keeps text inputs and skips pulling when no provider is configured", () => {
    const fetchStub = createFetchStub(() => ({ status: 200, payload: {} }));
    render(
      <ProviderSettingsPanel
        initialSettings={noneSettings}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );

    expect(fetchStub).not.toHaveBeenCalled();
    const modelInput = screen.getByLabelText("默认模型") as HTMLInputElement;
    expect(modelInput.tagName).toBe("INPUT");
    fireEvent.change(modelInput, { target: { value: "custom-model" } });
    expect(modelInput.value).toBe("custom-model");
  });

  it("re-pulls the llm model list from the refresh button with the edited base url", async () => {
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 200, payload: { ok: true, models: ["m-1", "m-2"] } };
      return { status: 200, payload: {} };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );
    await waitFor(() => expect(testBodies(fetchStub, "llm").length).toBe(1));

    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://new-llm.example.test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "拉取 LLM 模型列表" }));

    await waitFor(() => {
      const pulled = testBodies(fetchStub, "llm").filter(
        (body) => body.baseUrl === "https://new-llm.example.test"
      );
      expect(pulled.length).toBe(1);
    });
  });

  it("re-pulls model lists after a successful save", async () => {
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 200, payload: { ok: true, models: ["m-1", "m-2"] } };
      return { status: 200, payload: { updatedAt: "2026-09-17T08:00:00.000Z", settings: envSettings } };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={envSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
      />
    );
    await waitFor(() => expect(testBodies(fetchStub, "llm").length).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"));
    await waitFor(() => expect(testBodies(fetchStub, "llm").length).toBe(2));
    expect(testBodies(fetchStub, "image").length).toBe(2);
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
    await waitFor(() => expect(testBodies(fetchStub, "llm").length).toBe(1));

    const llmCard = screen.getByRole("group", { name: "LLM 网关" });
    fireEvent.click(within(llmCard).getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(within(llmCard).getAllByText(/连接成功 · 发现 2 个模型/).length).toBeGreaterThan(0));

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
    await waitFor(() => expect(within(llmCard).getByRole("alert").textContent).toContain("认证失败"));
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
    await waitFor(() => expect(putBodies(fetchStub).length).toBe(1));
    expect(putBodies(fetchStub)[0].llm).toBeNull();
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

  it("auto-pulls an extra site's models on mount and renders its model field as a select", async () => {
    const siteSettings: MaskedProviderSettings = {
      ...noneSettings,
      extraImageSites: [
        { baseUrl: "https://site-b.example.test", apiKey: "••••3333", model: "", source: "env" }
      ]
    };
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 200, payload: { ok: true, models: ["gpt-image-2", "dall-e-4"] } };
      return { status: 200, payload: {} };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={siteSettings}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );

    // 进页面就自动拉取（掩码 key 原样提交，服务端按 baseUrl 解析真值）：不必先点刷新图标。
    await waitFor(() => expect(testBodies(fetchStub).length).toBe(1));
    expect(testBodies(fetchStub)[0]).toMatchObject({
      scope: "image",
      baseUrl: "https://site-b.example.test",
      apiKey: "••••3333"
    });

    const siteSelect = await waitFor(() => {
      const select = screen.getByLabelText("站点 1 默认模型") as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      return select;
    });
    const values = selectOptions(siteSelect)!;
    expect(values).toContain("gpt-image-2");
    expect(values).toContain("dall-e-4");
    expect(within(siteSelect.parentElement!.parentElement!).getAllByText(/站点可用 · 2 个模型/).length).toBeGreaterThan(0);

    // 刷新按钮仍然保留：改过地址后可以手动重拉。
    fireEvent.click(screen.getByRole("button", { name: "拉取站点 1 模型列表" }));
    await waitFor(() => expect(testBodies(fetchStub).length).toBe(2));
  });

  it("aggregates every site's models into the main image model select, labelled by site", async () => {
    const multiSite: MaskedProviderSettings = {
      llm: null,
      image: {
        baseUrl: "https://env-image.example.test",
        apiKey: "••••2222",
        model: "env-image-model",
        source: "env"
      },
      extraImageSites: [
        { baseUrl: "https://site-b.example.test", apiKey: "••••3333", model: "", source: "env" }
      ]
    };
    const fetchStub = createFetchStub((url, init) => {
      if (!url.endsWith("/test")) return { status: 200, payload: {} };
      const body = JSON.parse(String(init?.body)) as { baseUrl: string };
      // 两站共享 flux-2：按站点优先级，归主站。
      return {
        status: 200,
        payload: {
          ok: true,
          models:
            body.baseUrl === "https://env-image.example.test"
              ? ["gpt-image-2", "flux-2"]
              : ["flux-2", "dall-e-4"]
        }
      };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={multiSite}
        initialUpdatedAt={null}
        fetchImpl={fetchStub}
      />
    );

    const imageSelect = await waitFor(() => {
      const select = screen.getByLabelText("生成模型") as HTMLSelectElement;
      // 主站 + 额外站点的模型都在候选里（服务端按模型归属路由站点）。
      expect(selectOptions(select)).toContain("dall-e-4");
      return select;
    });

    const values = selectOptions(imageSelect)!;
    expect(values).toContain("gpt-image-2");
    expect(values).toContain("flux-2");
    expect(values).toContain("env-image-model");

    // 跨站点时选项标出归属，避免同名模型分不清打到哪。
    expect(within(imageSelect).getByText("dall-e-4（site-b）")).toBeDefined();
    expect(within(imageSelect).getByText("gpt-image-2（env-image）")).toBeDefined();
    // 同名模型先到先得：flux-2 归主站。
    expect(within(imageSelect).getByText("flux-2（env-image）")).toBeDefined();
  });

  it("re-pulls extra sites after a successful save", async () => {
    const siteSettings: MaskedProviderSettings = {
      ...envSettings,
      extraImageSites: [
        { baseUrl: "https://site-b.example.test", apiKey: "••••3333", model: "", source: "env" }
      ]
    };
    const fetchStub = createFetchStub((url) => {
      if (url.endsWith("/test")) return { status: 200, payload: { ok: true, models: ["gpt-image-2"] } };
      return {
        status: 200,
        payload: { updatedAt: "2026-09-17T08:00:00.000Z", settings: siteSettings }
      };
    });
    render(
      <ProviderSettingsPanel
        initialSettings={siteSettings}
        initialUpdatedAt="2026-09-17T07:00:00.000Z"
        fetchImpl={fetchStub}
      />
    );
    await waitFor(() => expect(testBodies(fetchStub).length).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"));
    await waitFor(() => {
      const sitePulls = testBodies(fetchStub).filter(
        (body) => body.baseUrl === "https://site-b.example.test"
      );
      expect(sitePulls.length).toBe(2);
    });
  });
});
