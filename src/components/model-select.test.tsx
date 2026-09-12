import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelect } from "./model-select";

describe("ModelSelect", () => {
  it("exposes configured models through a labelled native select", async () => {
    const onChange = vi.fn();
    render(
      <ModelSelect
        enabled
        availableModels={["grok-4.6", "writer-large"]}
        value="grok-4.6"
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("生成模型"), "writer-large");

    expect(onChange).toHaveBeenCalledWith("writer-large");
  });

  it("shows the demo mode when no provider is configured", () => {
    render(<ModelSelect enabled={false} availableModels={[]} value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("生成模型")).toBeDisabled();
    expect(screen.getByRole("option", { name: "演示模式" })).toBeVisible();
  });

  it("refreshes available models from the adjacent icon button", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <ModelSelect
        enabled
        availableModels={["grok-4.6"]}
        value="grok-4.6"
        onRefresh={onRefresh}
        onChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "刷新可用模型" }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("disables model controls while refreshing", () => {
    render(
      <ModelSelect
        enabled
        availableModels={["grok-4.6"]}
        value="grok-4.6"
        refreshing
        onRefresh={vi.fn()}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("生成模型")).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新可用模型" })).toBeDisabled();
  });
});
